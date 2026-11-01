// Hide the console window that Windows would otherwise attach to a release
// build; the kernel's own output goes to the boot log, not to stdout.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dsh_link_lib::run()
}
