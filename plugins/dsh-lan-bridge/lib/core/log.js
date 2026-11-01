/**
 * Tagged diagnostics for the DSH LAN bridge.
 *
 * Host-plane logging must never leak into model context: this writes to the
 * host console only. Everything a bridge peer can influence (paths, commands,
 * peer names) is passed through `sanitize` so a hostile peer cannot forge log
 * lines or inject control characters into the terminal.
 */

const TAG = '[dsh-lan-bridge]'

/** Replace control characters and clamp length so peer input stays one line. */
export function sanitize(value, max = 400) {
  let text
  if (typeof value === 'string') text = value
  else {
    try {
      text = JSON.stringify(value)
    } catch {
      text = String(value)
    }
  }
  if (text === undefined) text = String(value)
  // eslint-disable-next-line no-control-regex
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, (c) => (c === '\n' ? '\\n' : ' '))
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function emit(level, message, extra) {
  const line = extra === undefined ? `${TAG} ${message}` : `${TAG} ${message} — ${sanitize(extra)}`
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  try {
    sink(line)
  } catch {
    /* a host without a console must not fail the plugin */
  }
}

export function createLogger(scope = '') {
  const prefix = scope === '' ? '' : `${scope} `
  return {
    info: (message, extra) => emit('info', `${prefix}${message}`, extra),
    warn: (message, extra) => emit('warn', `${prefix}${message}`, extra),
    error: (message, extra) => emit('error', `${prefix}${message}`, extra),
    child: (sub) => createLogger(scope === '' ? sub : `${scope}/${sub}`),
  }
}

export const log = createLogger()
export { TAG }
