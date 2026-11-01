//! A second APPLICATION, not the shipped one: it embeds DSH-LINK and calls it by name.
//!
//! `examples/host_embed.rs` proves the entry is callable from outside the crate; this is a real `[[bin]]` target of
//! the same package, built the way an application is built, with its own window label. Cargo picks up `src/bin/*.rs`
//! as binaries, so this file IS a second executable of the product (`cargo check --bin host-demo`).
//!
//! What it still does NOT do: embed into a window the host already owns. `run_with` creates DSH-LINK's own window
//! with the label handed in - that is the boundary the delivery page names.

fn main() {
    let label = std::env::args()
        .skip(1)
        .find(|arg| arg.starts_with("--window-label="))
        .map(|arg| arg.trim_start_matches("--window-label=").to_string())
        .unwrap_or_else(|| String::from("host-demo"));
    eprintln!("host-demo: embedding dsh-link as window {:?}", label);
    dsh_link_lib::embed::run_with(dsh_link_lib::embed::HostEmbed::with_window_label(label));
}
