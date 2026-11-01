/**
 * Minimal Chrome DevTools Protocol client.
 *
 * Uses the WHATWG `WebSocket` global (Node >= 22, Electron 37 ships Node 22), so
 * the package needs no runtime dependency at all — the same zero-dependency
 * property `dsh-lan-bridge` keeps, which is what lets a local package survive a
 * DSH upgrade that changes @deepseek-ai internals.
 *
 * Deliberately NOT exposed to callers: `Runtime.evaluate`, `DOM.*`, and every
 * other source/DOM-reading domain. This client only ever carries navigation,
 * screenshots, layout metrics, and raw input events.
 */

export class CdpError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'CdpError'
    if (code !== undefined) this.code = code
  }
}

export class CdpClient {
  #ws
  #seq = 0
  #pending = new Map()
  #listeners = new Map()
  #closed = false
  #closeReason = null

  constructor(ws) {
    this.#ws = ws
    ws.addEventListener('message', (event) => this.#onMessage(event))
    ws.addEventListener('close', () => {
      this.#closed = true
      this.#closeReason = this.#closeReason ?? 'socket closed'
      this.#failAll(new CdpError(`CDP connection closed (${this.#closeReason})`))
    })
    ws.addEventListener('error', () => {
      this.#closeReason = 'socket error'
    })
  }

  static async connect(wsUrl, { timeoutMs = 20000 } = {}) {
    // The host is Electron 37 (Node 22.x), which ships this global. Fail with a
    // legible message rather than a bare ReferenceError if that ever changes.
    if (typeof WebSocket !== 'function') {
      throw new CdpError('this host has no WHATWG WebSocket global; dsh-browser needs Node >= 22')
    }
    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new CdpError(`timed out connecting to ${wsUrl}`)),
        timeoutMs,
      )
      ws.addEventListener(
        'open',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true },
      )
      ws.addEventListener(
        'error',
        () => {
          clearTimeout(timer)
          reject(new CdpError(`websocket error connecting to ${wsUrl}`))
        },
        { once: true },
      )
    })
    return new CdpClient(ws)
  }

  get closed() {
    return this.#closed
  }

  #onMessage(event) {
    let msg
    try {
      msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
    } catch {
      return
    }
    if (msg.id !== undefined) {
      const entry = this.#pending.get(msg.id)
      if (entry === undefined) return
      this.#pending.delete(msg.id)
      clearTimeout(entry.timer)
      if (msg.error) entry.reject(new CdpError(msg.error.message ?? JSON.stringify(msg.error), msg.error.code))
      else entry.resolve(msg.result)
      return
    }
    if (typeof msg.method === 'string') {
      const list = this.#listeners.get(msg.method)
      if (list === undefined) return
      for (const listener of [...list]) {
        try {
          listener(msg.params ?? {})
        } catch {
          /* a listener must never break the transport */
        }
      }
    }
  }

  #failAll(error) {
    for (const [, entry] of this.#pending) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.#pending.clear()
  }

  /** Send one command and await its result. */
  send(method, params = {}, timeoutMs = 30000) {
    if (this.#closed) return Promise.reject(new CdpError(`CDP connection is closed (${this.#closeReason})`))
    const id = ++this.#seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.#pending.delete(id)) reject(new CdpError(`CDP command timed out: ${method}`))
      }, timeoutMs)
      this.#pending.set(id, { resolve, reject, timer })
      try {
        this.#ws.send(JSON.stringify({ id, method, params }))
      } catch (error) {
        clearTimeout(timer)
        this.#pending.delete(id)
        reject(new CdpError(`could not send ${method}: ${error?.message ?? error}`))
      }
    })
  }

  /** Subscribe to one CDP event; the returned disposer removes the listener. */
  on(method, listener) {
    const list = this.#listeners.get(method) ?? new Set()
    list.add(listener)
    this.#listeners.set(method, list)
    return () => {
      const current = this.#listeners.get(method)
      if (current === undefined) return
      current.delete(listener)
      if (current.size === 0) this.#listeners.delete(method)
    }
  }

  /** Resolve on the next occurrence of one event, or reject on timeout. */
  waitFor(method, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const off = this.on(method, (params) => {
        clearTimeout(timer)
        off()
        resolve(params)
      })
      const timer = setTimeout(() => {
        off()
        reject(new CdpError(`timed out waiting for ${method}`))
      }, timeoutMs)
    })
  }

  close(reason = 'client closed') {
    this.#closeReason = reason
    this.#closed = true
    this.#failAll(new CdpError(`CDP connection closed (${reason})`))
    try {
      this.#ws.close()
    } catch {
      /* ignore */
    }
  }
}
