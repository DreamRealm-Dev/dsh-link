/**
 * Host half of dsh-link-brand.
 *
 * The marks are a browser concern: the client half registers them into the
 * client's own brand slots, so there is nothing for the Host to provide,
 * persist, or serve. The package declares `dsh.client` so the client module
 * system loads `./client`; this half exists only to be a valid Loader entry.
 */

/** Loader entry name for the diagnostics surface. */
export const name = 'link-brand'

/** No Host behaviour. */
export function apply(): void {}
