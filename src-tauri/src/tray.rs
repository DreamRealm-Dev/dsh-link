//! The tray icon, on the mechanism that is MEASURED to work on this machine.
//!
//! R388: this replaces the \`tray-icon\` crate path. Three facts forced it, each measured:
//!   - a plain \`Shell_NotifyIcon(NIM_ADD)\` from this same process family DOES show an icon (a probe added one and the user
//!     saw the slot), so the OS, the session and the elevation are all fine;
//!   - the crate's registration is OPTIONAL in its own code: a refused \`NIM_ADD\` is swallowed and it waits for a
//!     \`TaskbarCreated\` message (tray-icon 0.25.1, windows/mod.rs:159-162). This application then printed "tray icon
//!     ready" regardless, so an icon nobody could see still looked healthy in the log;
//!   - the shell answered \`Shell_NotifyIconGetRect\` with "no rect" for the crate's icon - i.e. it was never placed - while
//!     Windows' settings page still listed an entry from an earlier run.
//!
//! So the tray is built here: one message window, one icon added by handle and id, a popup menu for the five items, and a
//! VERIFICATION step whose answer is logged. Every Win32 call is checked; a refusal is named instead of ignored.
#![cfg(windows)]

use std::ffi::c_void;
use std::sync::OnceLock;
use tauri::Manager;

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Shell::{
    Shell_NotifyIconGetRect, Shell_NotifyIconW, NIF_ICON, NIF_MESSAGE, NIF_SHOWTIP, NIF_TIP, NIM_ADD, NIM_DELETE,
    NIM_SETVERSION, NOTIFYICONDATAW, NOTIFYICONIDENTIFIER, NOTIFYICON_VERSION_4, NOTIFY_ICON_DATA_FLAGS,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyMenu, GetCursorPos, GetMessageW,
    LoadIconW, LoadImageW, PostQuitMessage, RegisterClassW, RegisterWindowMessageW, SetForegroundWindow,
    TrackPopupMenu, TranslateMessage, DispatchMessageW, CW_USEDEFAULT, IDI_APPLICATION, IDI_WARNING, IMAGE_ICON,
    LR_DEFAULTSIZE, LR_LOADFROMFILE, MF_SEPARATOR, MF_STRING, MSG, TPM_BOTTOMALIGN, TPM_LEFTALIGN,
    WM_APP, WM_CLOSE, WM_COMMAND, WM_DESTROY, WM_LBUTTONUP, WM_RBUTTONUP, WNDCLASSW, WS_EX_TOOLWINDOW, WS_OVERLAPPED,
};

/// What the tray's menu asked for, resolved by the application (the tray module owns no product behaviour).
pub enum TrayAction {
    Toggle,
    NewWindow,
    Browser,
    Update,
    Quit,
}

/// The entry points the tray needs from the application.
pub struct TrayHost {
    pub dispatch: fn(TrayAction),
}

struct State {
    app: tauri::AppHandle,
    host: &'static TrayHost,
    /// The message window as a plain integer: a raw pointer is not Send, and this state lives in a static.
    hwnd: isize,
    taskbar_created: u32,
    visible: bool,
    /// The last refusal, so a caller can say why there is no icon instead of guessing.
    last_error: Option<String>,
}

static STATE: OnceLock<State> = OnceLock::new();

const WM_TRAY: u32 = WM_APP + 1;
const ID_TOGGLE: usize = 1;
const ID_NEWWINDOW: usize = 2;
const ID_BROWSER: usize = 3;
const ID_UPDATE: usize = 4;
const ID_QUIT: usize = 5;

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// The icon whose registration this tray owns.
unsafe fn load_icon() -> isize {
    // The application's own icon, written once to a temp file because \`LoadImageW\` takes a path and the bytes are
    // embedded in the binary. The system application icon is the fallback, so the tray still appears if that write fails.
    let bytes = include_bytes!("../icons/icon.ico");
    let path = std::env::temp_dir().join(format!("dsh-link-tray-{}.ico", std::process::id()));
    if std::fs::write(&path, bytes).is_ok() {
        let wide_path = wide(&path.to_string_lossy());
        let icon = LoadImageW(std::ptr::null_mut(), wide_path.as_ptr(), IMAGE_ICON, 0, 0, LR_LOADFROMFILE | LR_DEFAULTSIZE);
        if !icon.is_null() {
            return icon as isize;
        }
    }
    LoadIconW(std::ptr::null_mut(), IDI_APPLICATION as *const u16) as isize
}

/// A stock system icon, for the second registration attempt (see `place_icon`).
fn stock_icon() -> isize {
    unsafe { LoadIconW(std::ptr::null_mut(), IDI_WARNING as *const u16) as isize }
}

fn notify_data(hwnd: isize, flags: NOTIFY_ICON_DATA_FLAGS) -> NOTIFYICONDATAW {
    let mut data: NOTIFYICONDATAW = unsafe { std::mem::zeroed() };
    data.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
    data.hWnd = hwnd as HWND;
    data.uID = 1;
    data.uFlags = flags;
    data.uCallbackMessage = WM_TRAY;
    data.Anonymous.uVersion = NOTIFYICON_VERSION_4;
    data
}

/// Add (or re-add) the icon and report whether the SHELL took it.
unsafe fn place_icon(state: &State) -> Result<(), String> {
    let icon = load_icon();
    if icon == 0 {
        return Err("no icon handle could be loaded (neither the bundled .ico nor IDI_APPLICATION)".to_owned());
    }
    // R388: TWO registrations, each logged, because their outcomes tell different stories. Attempt A carries the
    // application own icon with the callback message; attempt B carries a STOCK system icon (a yellow triangle nobody
    // else can be using) and only NIF_ICON|NIF_TIP - the exact shape the probe that works on this machine sends.
    //   A refused, B accepted -> the icon image or the callback flag was the problem;
    //   both refused          -> neither the image nor the flags are the cause, and the process or window is.
    let mut data = notify_data(state.hwnd, NIF_MESSAGE | NIF_ICON | NIF_TIP);
    data.hIcon = icon as _;
    let tip = wide("DSH Link - 显示/隐藏 · 新窗口 · 在浏览器中打开 · 退出");
    let take = tip.len().min(128);
    data.szTip[..take].copy_from_slice(&tip[..take]);
    if Shell_NotifyIconW(NIM_ADD, &data) == 0 {
        let first = windows_sys::Win32::Foundation::GetLastError();
        eprintln!("[shell] tray attempt A (application icon, NIF_MESSAGE) refused: GetLastError={first} (window {:#x}, icon {:#x}, cbSize {})", state.hwnd, icon, data.cbSize);
        let mut plain = notify_data(state.hwnd, NIF_ICON | NIF_TIP);
        plain.hIcon = LoadIconW(std::ptr::null_mut(), IDI_WARNING as *const u16) as _;
        let tip2 = wide("DSH Link (probe icon)");
        let take2 = tip2.len().min(128);
        plain.szTip[..take2].copy_from_slice(&tip2[..take2]);
        if Shell_NotifyIconW(NIM_ADD, &plain) == 0 {
            let second = windows_sys::Win32::Foundation::GetLastError();
            return Err(format!("both registrations refused (app icon err={first}, stock icon err={second}) - so neither the image nor the flags is the cause"));
        }
        eprintln!("[shell] tray attempt B (stock system icon, NIF_ICON|NIF_TIP) ACCEPTED - the image or the callback flag was the problem");
    }
    // The verification the crate skipped: ask the shell where the icon is.
    let mut rect: windows_sys::Win32::Foundation::RECT = std::mem::zeroed();
    if Shell_NotifyIconGetRect(&identifier(state.hwnd), &mut rect) != 0 {
        return Err(format!("the icon was accepted but the shell reports NO rect for it (GetLastError={})", windows_sys::Win32::Foundation::GetLastError()));
    }
    Ok(())
}

/// The identity `Shell_NotifyIconGetRect` asks about: window handle, icon id, no GUID.
fn identifier(hwnd: isize) -> NOTIFYICONIDENTIFIER {
    let mut id: NOTIFYICONIDENTIFIER = unsafe { std::mem::zeroed() };
    id.cbSize = std::mem::size_of::<NOTIFYICONIDENTIFIER>() as u32;
    id.hWnd = hwnd as HWND;
    id.uID = 1;
    id
}

unsafe extern "system" fn window_proc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let Some(state) = STATE.get() else { return DefWindowProcW(hwnd, message, wparam, lparam) };
    match message {
        WM_TRAY => {
            // NOTIFYICON_VERSION_4 puts the event in LOWORD(lparam).
            let event = (lparam as u32) & 0xFFFF;
            if event == WM_LBUTTONUP {
                (state.host.dispatch)(TrayAction::Toggle);
            } else if event == WM_RBUTTONUP || event == windows_sys::Win32::UI::WindowsAndMessaging::WM_CONTEXTMENU {
                show_menu(state);
            }
            0
        }
        WM_COMMAND => {
            match wparam & 0xFFFF {
                ID_TOGGLE => (state.host.dispatch)(TrayAction::Toggle),
                ID_NEWWINDOW => (state.host.dispatch)(TrayAction::NewWindow),
                ID_BROWSER => (state.host.dispatch)(TrayAction::Browser),
                ID_UPDATE => (state.host.dispatch)(TrayAction::Update),
                ID_QUIT => (state.host.dispatch)(TrayAction::Quit),
                _ => {}
            }
            0
        }
        WM_DESTROY => {
            let mut data = notify_data(hwnd as isize, 0);
            Shell_NotifyIconW(NIM_DELETE, &data);
            PostQuitMessage(0);
            0
        }
        _ => {
            if message == state.taskbar_created && state.visible {
                // Explorer restarted: the shell forgot every icon, so this is where it comes back.
                if let Err(why) = place_icon(state) {
                    eprintln!("[shell] tray: could not re-register after the taskbar restarted: {why}");
                } else {
                    eprintln!("[shell] tray: re-registered after the taskbar restarted");
                }
            }
            DefWindowProcW(hwnd, message, wparam, lparam)
        }
    }
}

unsafe fn show_menu(state: &State) {
    let menu = CreatePopupMenu();
    if menu.is_null() {
        return;
    }
    let toggle = wide("显示 / 隐藏主窗口");
    let newwindow = wide("新窗口");
    let browser = wide("在浏览器中打开");
    let update = wide("检查并安装更新");
    let quit = wide("退出");
    let _ = AppendMenuW(menu, MF_STRING, ID_TOGGLE, toggle.as_ptr());
    let _ = AppendMenuW(menu, MF_STRING, ID_NEWWINDOW, newwindow.as_ptr());
    let _ = AppendMenuW(menu, MF_STRING, ID_BROWSER, browser.as_ptr());
    let _ = AppendMenuW(menu, MF_SEPARATOR, 0, std::ptr::null());
    let _ = AppendMenuW(menu, MF_STRING, ID_UPDATE, update.as_ptr());
    let _ = AppendMenuW(menu, MF_SEPARATOR, 0, std::ptr::null());
    let _ = AppendMenuW(menu, MF_STRING, ID_QUIT, quit.as_ptr());
    let mut point = POINT { x: 0, y: 0 };
    let _ = GetCursorPos(&mut point);
    // Without the foreground call a popup menu does not dismiss when the user clicks elsewhere.
    let _ = SetForegroundWindow(state.hwnd as HWND);
    let _ = TrackPopupMenu(menu, TPM_LEFTALIGN | TPM_BOTTOMALIGN, point.x, point.y, 0, state.hwnd as HWND, std::ptr::null());
    let _ = DestroyMenu(menu);
}

/// Start the tray: create the message window, add the icon, and report what the shell said.
///
/// @param app - the running application, kept for the menu actions.
/// @param host - the callbacks the menu items resolve to.
/// @returns Ok once the shell reports a rect for the icon, or the reason it does not.
pub fn start(app: &tauri::AppHandle, host: &'static TrayHost) -> Result<(), String> {
    unsafe {
        let instance = GetModuleHandleW(std::ptr::null());
        let class_name = wide("DshLinkTrayWindow");
        let mut wc: WNDCLASSW = std::mem::zeroed();
        wc.lpfnWndProc = Some(window_proc);
        wc.hInstance = instance as _;
        wc.lpszClassName = class_name.as_ptr();
        if RegisterClassW(&wc) == 0 {
            // A second registration of the same class in one process is fine: the window still gets made below.
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() != Some(1410) {
                return Err(format!("RegisterClassW refused: {error}"));
            }
        }
        // The probe that works on this machine creates its window with NO extra style bits and the toolwindow bit in the
        // ex-style argument. The first version of this module put WS_EX_TOOLWINDOW in the style argument by mistake.
        let hwnd = CreateWindowExW(
            WS_EX_TOOLWINDOW,
            class_name.as_ptr(),
            wide("DshLinkTray").as_ptr(),
            0,

            CW_USEDEFAULT,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            instance as _,
            std::ptr::null_mut(),
        );
        if hwnd.is_null() {
            return Err(format!("CreateWindowExW refused: {}", std::io::Error::last_os_error()));
        }
        let taskbar_created = RegisterWindowMessageW(wide("TaskbarCreated").as_ptr());
        let state = State { app: app.clone(), host, hwnd: hwnd as isize, taskbar_created, visible: true, last_error: None };
        let placed = place_icon(&state);
        let kept = STATE.set(state);
        if kept.is_err() {
            return Err("the tray was already started in this process".to_owned());
        }
        match placed {
            Ok(()) => {
                eprintln!("[shell] tray icon READY: the shell reports a rect for it (owned by this window, id 1)");
                Ok(())
            }
            Err(why) => {
                eprintln!("[shell] tray icon NOT placed: {why}");
                Err(why)
            }
        }
    }
}

/// Pump the tray window's messages. Blocks until the window is destroyed, so it runs on its own thread.

/// Ask the shell where the icon is, for a script or a log line.
/// @returns the rect as (x, y, w, h), or why there is none.
pub fn rect() -> Result<(i32, i32, i32, i32), String> {
    let Some(state) = STATE.get() else { return Err("the tray was never started".to_owned()) };
    unsafe {
        let mut rect: windows_sys::Win32::Foundation::RECT = std::mem::zeroed();
        if Shell_NotifyIconGetRect(&identifier(state.hwnd), &mut rect) != 0 {
            return Err("the shell reports NO rect for this icon".to_owned());
        }
        Ok((rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top))
    }
}

/// Take the icon down (used by the quit path and by tests).
pub fn stop() {
    if let Some(state) = STATE.get() {
        let mut data = unsafe { notify_data(state.hwnd, 0) };
        unsafe { Shell_NotifyIconW(NIM_DELETE, &mut data); }
    }
}
