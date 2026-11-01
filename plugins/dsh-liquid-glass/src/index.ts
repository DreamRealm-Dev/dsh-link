/**
 * Host half of dsh-liquid-glass.
 *
 * The material is entirely a browser concern: it is CSS gated by an attribute on
 * the document element, so there is nothing for the Host to provide, persist, or
 * serve. The package declares `dsh.client` so the client module system loads
 * `./client`; this half exists only to be a valid Loader entry.
 *
 * The preference that selects a style is owned by dsh-theme-settings, which is
 * the plugin whose entry id is the settings namespace.
 */

/** Loader entry name for the diagnostics surface. */
export const name = 'liquid-glass'

/** No Host behaviour. */
export function apply(): void {}
