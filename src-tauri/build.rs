/// Regenerate the Windows resource whenever the artwork changes.
///
/// `tauri_build::build()` embeds `icons/icon.ico` as the executable's icon — the icon
/// Explorer, the taskbar and the installer read — but it declares neither the icons
/// nor the config that names them as inputs, so cargo happily relinks an executable
/// around a resource built from the previous artwork. Replacing the icons and running
/// `cargo build` therefore leaves the old icon in the binary with no warning; this
/// line is what makes the resource follow the artwork.
fn main() {
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
