//! Releasing the writer locks a dead kernel left behind.
//!
//! The kernel guards every document it writes with a "<file>.lock" sibling, created by an
//! exclusive create and holding the writing process id. Its own takeover test accepts only a
//! record that matches "<pid>\n"; anything else -- an empty file, a record cut short -- is
//! read as "being written, or was cut short", which proves nothing about its holder. Such a
//! file is therefore never taken over and never removed, so one interrupted write blocks
//! every later write to that document for the life of the install, and the only symptom is
//! a timeout that names the lock.
//!
//! The kernel is pinned and read-only here, so the shell does the one thing it can do
//! safely: release that residue while no kernel of ours can be writing -- before the child
//! is spawned, on every launch. The outcomes are the kernel's own semantics plus the case
//! the kernel cannot act on:
//!
//! | the lock file | decision |
//! |---|---|
//! | absent | nothing |
//! | empty, or not a "<pid>\n" record | released: no holder can be proven, and none can release it |
//! | a "<pid>\n" record whose process is gone | released: the kernel would take this one over by itself |
//! | a "<pid>\n" record whose process is running | kept: another writer owns it |
//! | a "<pid>\n" record this platform will not answer for | kept, and said out loud: a probe that cannot answer is not evidence of a dead holder |
//!
//! A record naming process id 0, or an id outside the positive int32 range, counts as
//! malformed: the test above refuses those too, so they are equally permanent.
//!
//! Keeping a lock for want of an answer costs a wait, never a document. Kernel writes go
//! through packages/util/atomic-write/src/index.ts, whose contender takes over a well-formed
//! lock as soon as its own probe finds no process with the recorded id, and fails the write
//! with the lock's path in the message rather than proceeding without it. The residue only
//! this module can release is the malformed record, which that takeover test refuses by
//! construction.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// What one startup decided about one lock file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// The file was removed: nothing alive could have released it.
    Released,
    /// The file was left alone: its recorded holder is running.
    Kept,
}

/// One lock file this startup examined, and the line that says what was decided and why.
///
/// The line is the same text in both logs, so a reader compares one string rather than two
/// accounts of the same event. Every line starts with "writer lock: " and carries the verdict
/// as a word, which is what makes them greppable from a boot log.
#[derive(Debug, Clone)]
pub struct Report {
    /// What was decided.
    pub verdict: Verdict,
    /// The one line to write to the shell log and to the boot log. It names the file it is
    /// about, so nothing here has to carry the path separately.
    pub line: String,
}

/// Release the writer locks under the profiles root that no live holder owns.
///
/// The argument is <DSH_HOME>/profiles. Each profile directory inside it is scanned for
/// "*.lock" files, because the kernel names a lock after the document it guards
/// (package.json.lock, cordis.patch.yml.lock) rather than from a fixed list, and nothing
/// here assumes which documents those are.
///
/// The caller runs this before spawning the kernel, and that ordering is what makes
/// releasing safe: no holder can be mid-write. A file that cannot be read, and a holder that
/// cannot be probed on this platform, are both reported as kept -- releasing a live writer
/// lock is the one mistake here that can lose data.
pub fn release_stale(profiles: &Path) -> Vec<Report> {
    let mut found = Vec::new();
    collect_locks(profiles, 1, &mut found);
    found.sort();
    found.into_iter().map(examine).collect()
}

/// Collect "*.lock" files in that directory and, when the depth allows, in its immediate
/// children.
///
/// One level below the profiles root is exactly profiles/<profile>/, which is where the
/// kernel keeps them; stopping there keeps a launch from walking every profile node_modules
/// tree to find a lock file that is not in one.
fn collect_locks(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut paths: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
    paths.sort();
    for path in paths {
        if path.is_dir() {
            if depth > 0 {
                collect_locks(&path, depth - 1, out);
            }
        } else if path.extension().is_some_and(|extension| extension == "lock") {
            out.push(path);
        }
    }
}

/// Decide one lock file's fate, and remove it when nothing alive owns it.
fn examine(path: PathBuf) -> Report {
    let Ok(record) = fs::read_to_string(&path) else {
        return Report {
            verdict: Verdict::Kept,
            line: format!(
                "writer lock: kept {} -- the file could not be read, so nothing is proven about its holder",
                path.display()
            ),
        };
    };
    let shown = path.display().to_string();
    let Some(pid) = record_pid(&record) else {
        let content = if record.is_empty() { "<empty>".to_owned() } else { format!("{record:?}") };
        return release(path, format!(
            "writer lock: released {shown} -- content {content} is not the pid record the kernel can take over, so this lock would never be released and every write to its document would wait for it until it timed out"
        ));
    };
    match process_alive(pid) {
        Some(true) => Report {
            verdict: Verdict::Kept,
            line: format!("writer lock: kept {} -- holder pid {pid} is still running", path.display()),
        },
        Some(false) => release(path, format!(
            "writer lock: released {shown} -- holder pid {pid} is gone (record {record:?}), which is the case the kernel itself takes over"
        )),
        None => Report {
            verdict: Verdict::Kept,
            line: format!(
                "writer lock: kept {} -- holder pid {pid} could not be probed on this platform, and releasing a live writer lock is the mistake that loses data",
                path.display()
            ),
        },
    }
}

/// Remove a lock nothing alive owns, keeping the decision in the returned report.
fn release(path: PathBuf, line: String) -> Report {
    match fs::remove_file(&path) {
        Ok(()) => Report { verdict: Verdict::Released, line },
        Err(error) => Report {
            verdict: Verdict::Kept,
            line: format!("{line} -- but removing it failed ({error})"),
        },
    }
}

/// The process id a "<pid>\n" record names, in the form the takeover test accepts.
///
/// The trailing newline is part of the record: the kernel writes pid and newline in one
/// call, so a file without it is a write that was cut short. Id 0 addresses the caller's
/// process group and is refused there as well.
fn record_pid(record: &str) -> Option<u32> {
    let body = record.strip_suffix('\n')?;
    if body.is_empty() || !body.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let pid: u32 = body.parse().ok()?;
    if pid == 0 || pid > 0x7fff_ffff {
        return None;
    }
    Some(pid)
}

/// Whether a process with this id is running, as far as this platform can tell.
///
/// None means the probe could not answer at all, which the caller treats as kept.
///
/// Windows asks the kernel about the process itself. The machine's process list is not the
/// question: a process that spawns `tasklist` is shown a subset of the machine's processes, so
/// "the list does not name this id" is satisfied by live processes and cannot support the
/// answer "gone". Measured in this session (R184-C, .tmp/r184-c/probe-matrix.rs, three rounds,
/// `.tmp/r184-c/probe-run.txt`): a spawned process's `tasklist /NH /FO CSV` listed 168-176
/// rows of the 576-580 its parent saw, it answered "not listed" for System (pid 4), for its own
/// parent node process and for explorer.exe while all of them were running, and
/// `tasklist /FI "PID eq <pid>" /NH` returned that same subset rather than a second opinion.
/// Opening the process answered "running" for every one of them and "gone" only where the
/// process was certainly gone. The list is still consulted, but only in the one direction it
/// can prove: naming the id proves the process is running.
///
/// Elsewhere "kill -0" is the same probe the kernel itself uses. On a Unix host where the
/// holder runs as another user that probe reports failure for a live process, which is the
/// direction that releases a lock instead of keeping it -- this shell launches its kernel as
/// the same user, so it does not arise here.
fn process_alive(pid: u32) -> Option<bool> {
    #[cfg(windows)]
    {
        if let Some(alive) = handle_probe::state(pid) {
            return Some(alive);
        }
        // The kernel would not answer. A listing that names the id still proves the process is
        // running; a listing that does not name it proves nothing, so it is not consulted for
        // the other answer.
        if names_pid(pid) {
            return Some(true);
        }
        None
    }
    #[cfg(not(windows))]
    {
        let status = Command::new("kill").arg("-0").arg(pid.to_string()).status().ok()?;
        Some(status.success())
    }
}

/// The kernel's own answer about one process, asked about the process itself.
///
/// The three outcomes are different kinds of fact, and the caller's decision turns on the
/// difference: an id no process has is the only one that releases a lock, a refusal to open
/// means a live process this one may not touch, and everything else -- including a handle the
/// kernel refused for a reason it does not name -- is left as unknown for the caller to keep.
#[cfg(windows)]
mod handle_probe {
    use core::ffi::c_void;

    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(desired_access: u32, inherit_handle: i32, pid: u32) -> *mut c_void;
        fn GetExitCodeProcess(process: *mut c_void, exit_code: *mut u32) -> i32;
        fn WaitForSingleObject(handle: *mut c_void, milliseconds: u32) -> u32;
        fn CloseHandle(object: *mut c_void) -> i32;
        fn GetLastError() -> u32;
    }

    /// Enough to ask a process whether it has ended, which is also what the wait needs.
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const SYNCHRONIZE: u32 = 0x0010_0000;
    /// The exit code a running process reports -- and one an exited process can report too.
    const STILL_ACTIVE: u32 = 259;
    const WAIT_OBJECT_0: u32 = 0;
    const WAIT_TIMEOUT: u32 = 258;
    /// No process has this id: the answer that proves a recorded holder is gone.
    const ERROR_INVALID_PARAMETER: u32 = 87;
    /// The process exists and this one may not open it.
    const ERROR_ACCESS_DENIED: u32 = 5;

    /// Some(true) running, Some(false) gone, None unanswerable.
    pub(super) fn state(pid: u32) -> Option<bool> {
        // SAFETY: both arguments are plain integers; the returned handle is owned by this
        // function and closed on the one path that receives one.
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, 0, pid) };
        if handle.is_null() {
            // SAFETY: reads this thread's last-error value, which the call just above set:
            // nothing between the two calls reaches the system.
            let error = unsafe { GetLastError() };
            return match error {
                ERROR_INVALID_PARAMETER => Some(false),
                ERROR_ACCESS_DENIED => Some(true),
                _ => None,
            };
        }
        let mut exit_code = 0;
        // SAFETY: the handle is open and the out-parameter points at this frame's variable.
        let read_exit = unsafe { GetExitCodeProcess(handle, &mut exit_code) } != 0;
        // SAFETY: the same open handle; a zero timeout makes this a question, not a wait.
        let waited = unsafe { WaitForSingleObject(handle, 0) };
        // SAFETY: this is the only owner of the handle, and nothing uses it afterwards.
        unsafe { CloseHandle(handle) };
        match waited {
            // A process handle signals when the process ends, whatever it exited with, so this
            // pair is the answer that needs no qualification: the exit code cannot carry it
            // alone, because a process that exited with STILL_ACTIVE (259) reports 259 too.
            WAIT_OBJECT_0 => Some(false),
            WAIT_TIMEOUT => Some(true),
            _ if read_exit && exit_code != STILL_ACTIVE => Some(false),
            _ => None,
        }
    }
}

/// Whether the platform's process list names this id.
///
/// Read as proof of presence only. The listing is the weaker of the two probes, and this
/// function answers the question the caller may act on; a miss is left to the caller as
/// unknown, never as "gone".
#[cfg(windows)]
fn names_pid(pid: u32) -> bool {
    let Ok(output) = Command::new("tasklist").args(["/NH", "/FO", "CSV"]).output() else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    names_pid_in(&String::from_utf8_lossy(&output.stdout), pid)
}

/// Whether one `tasklist /NH /FO CSV` listing names this id.
///
/// The id is never the first CSV field, so it always sits between two commas.
#[cfg(windows)]
fn names_pid_in(listing: &str, pid: u32) -> bool {
    listing.contains(&format!(",\"{pid}\","))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A profile directory of the caller's own, named for the test that is using it.
    fn profile_dir(test: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dsh-link-writer-lock-{test}")).join("web");
        let _ = fs::remove_dir_all(dir.parent().unwrap());
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn plant(dir: &Path, name: &str, content: &str) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, content).unwrap();
        path
    }

    /// A process id that has certainly exited: a child this test waited for.
    fn dead_pid() -> u32 {
        #[cfg(windows)]
        let mut child = Command::new("cmd").args(["/C", "exit"]).spawn().unwrap();
        #[cfg(not(windows))]
        let mut child = Command::new("sh").args(["-c", "true"]).spawn().unwrap();
        let pid = child.id();
        child.wait().unwrap();
        pid
    }

    #[test]
    fn releases_an_empty_lock_and_says_so() {
        let dir = profile_dir("empty");
        let path = plant(&dir, "package.json.lock", "");
        let reports = release_stale(dir.parent().unwrap());
        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0].verdict, Verdict::Released);
        assert!(!path.exists(), "the empty lock is gone");
        assert!(reports[0].line.contains("<empty>"), "the line names the content: {}", reports[0].line);
    }

    #[test]
    fn releases_a_record_that_was_cut_short() {
        let dir = profile_dir("truncated");
        let path = plant(&dir, "package.json.lock", "1234");
        let reports = release_stale(dir.parent().unwrap());
        assert_eq!(reports[0].verdict, Verdict::Released);
        assert!(!path.exists(), "a record without its newline is residue from a cut-short write");
    }

    #[test]
    fn keeps_a_lock_whose_holder_is_running() {
        let dir = profile_dir("alive");
        let path = plant(&dir, "package.json.lock", &format!("{}\n", std::process::id()));
        let reports = release_stale(dir.parent().unwrap());
        assert_eq!(reports[0].verdict, Verdict::Kept);
        assert!(path.exists(), "a live holder keeps its lock");
        assert!(reports[0].line.contains("still running"), "{}", reports[0].line);
    }

    #[test]
    fn releases_a_lock_whose_holder_is_gone() {
        let dir = profile_dir("gone");
        let path = plant(&dir, "package.json.lock", &format!("{}\n", dead_pid()));
        let reports = release_stale(dir.parent().unwrap());
        assert_eq!(reports[0].verdict, Verdict::Released);
        assert!(!path.exists(), "a gone holder cannot release its own lock");
        assert!(reports[0].line.contains("is gone"), "{}", reports[0].line);
    }

    /// The direction the list-based probe got wrong: a live process the process list a spawned
    /// process is shown does not name. System (pid 4) is on every Windows machine and is one of
    /// the processes R184-C measured as absent from a spawned view of 168 rows of a 576-process
    /// machine, so it stands in for the live writer whose lock used to be released.
    #[cfg(windows)]
    #[test]
    fn keeps_a_lock_whose_live_holder_the_process_list_does_not_name() {
        assert_eq!(process_alive(4), Some(true), "System runs on this machine");
        let dir = profile_dir("live-holder-not-listed");
        let path = plant(&dir, "package.json.lock", "4\n");
        let reports = release_stale(dir.parent().unwrap());
        assert_eq!(reports[0].verdict, Verdict::Kept);
        assert!(path.exists(), "a live holder keeps its lock: {}", reports[0].line);
        assert!(reports[0].line.contains("still running"), "{}", reports[0].line);
    }

    /// The other half of the same contract: the probe this test replaced could not say "gone"
    /// at all without a process list, so "gone" is still answered for an id no process has.
    #[cfg(windows)]
    #[test]
    fn calls_a_pid_no_process_has_gone() {
        assert_eq!(process_alive(0x7fff_fffe), Some(false), "an unissued id is gone");
    }

    /// The fallback listing is read for presence only, which this shape decides on.
    #[cfg(windows)]
    #[test]
    fn reads_a_pid_out_of_a_listing() {
        let listing = "\"dsh-link.exe\",\"27812\",\"Console\",\"2\",\"70,784 K\"\n\
                       \"node.exe\",\"31700\",\"Console\",\"2\",\"120,000 K\"\n";
        assert!(names_pid_in(listing, 27812));
        assert!(names_pid_in(listing, 31700));
        assert!(!names_pid_in(listing, 2781), "the id is a whole field, not a prefix");
        assert!(!names_pid_in(listing, 4), "a pid the listing does not name is not found in it");
    }

    #[test]
    fn leaves_an_absent_profile_tree_alone() {
        let dir = std::env::temp_dir().join("dsh-link-writer-lock-absent");
        let _ = fs::remove_dir_all(&dir);
        assert!(release_stale(&dir.join("profiles")).is_empty());
    }

    #[test]
    fn ignores_files_that_are_not_locks() {
        let dir = profile_dir("unrelated");
        plant(&dir, "package.json", "{}");
        plant(&dir, "pnpm-lock.yaml", "lockfileVersion: 9\n");
        assert!(release_stale(dir.parent().unwrap()).is_empty());
    }
}
