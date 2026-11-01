/**
 * Package-tagged logging. A real (non-dynamic) Cordis package runs in the host
 * Node process, so the ordinary console is available; the tag is what makes the
 * output attributable in desktop.log / the backend stderr tail.
 */
const TAG = '[dsh-browser]'

function fmt(args) {
  return args.map((a) => (a instanceof Error ? (a.stack ?? a.message) : a))
}

export const log = {
  info: (...args) => console.log(TAG, ...fmt(args)),
  warn: (...args) => console.warn(TAG, ...fmt(args)),
  error: (...args) => console.error(TAG, ...fmt(args)),
}
