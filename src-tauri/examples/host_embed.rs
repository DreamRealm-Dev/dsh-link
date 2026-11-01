//! Requirement D, second step: a HOST binary that embeds DSH-LINK instead of being it.
//!
//! The crate's entry point is `embed::run_with(HostEmbed)`: a host hands in the window label it wants and the same
//! application code path runs. This example is the smallest thing that proves the entry is CALLABLE FROM OUTSIDE the
//! crate and that the label travels: it compiles against the shipped library (`cargo check --example host_embed`) and
//! prints the label it installed before running.
//!
//! Running it starts a real DSH-LINK window labelled `host-main`; the point of this file is the compile and the label,
//! not a second product.

fn main() {
    let config = dsh_link_lib::embed::HostEmbed::with_window_label("host-main");
    println!(
        "host: asking dsh-link to run as window {:?} (application default is {:?})",
        config.window_label,
        dsh_link_lib::embed::HostEmbed::default().window_label
    );
    dsh_link_lib::embed::run_with(config);
}
