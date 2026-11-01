/**
 * frame.js — DSH LAN Bridge wire framing (protocol layer 1).
 *
 * Zero dependencies: node:buffer only.
 *
 * Wire format (all integers big-endian):
 *
 *   +------------------+------------------+---------------------+----------------+
 *   | totalLen  u32be  | headerLen u32be  | headerLen bytes UTF8| payload        |
 *   +------------------+------------------+---------------------+----------------+
 *   ^-- offset 0                                        ... totalLen counts
 *                                                       everything after offset 0
 *
 *   totalLen  = 4 + headerLen + payloadLen
 *   headerLen = length of the JSON header (never 0, never > maxHeaderBytes)
 *   payload   = optional opaque binary body (totalLen - 4 - headerLen bytes)
 *
 * Deliberate design choices:
 *  - One single length prefix for the whole frame keeps the reader O(n) with a
 *    single allocate-on-complete copy, and makes "how many bytes do I still
 *    need" answerable without parsing anything.
 *  - The header is JSON (human-debuggable, schema-free, forward compatible).
 *  - The payload is raw bytes so file chunks / stdout do not pay base64 (33%)
 *    or JSON-escape costs.
 *  - There is no per-frame magic number: the first frame of a connection is a
 *    `hello` whose header carries the protocol magic, which is enough to fail
 *    fast on a wrong-port / wrong-protocol peer without paying 4 bytes forever.
 *
 * Hard limits (see MAX_FRAME_BYTES / HARD_MAX_FRAME_BYTES):
 *  - A frame whose declared totalLen exceeds maxFrameBytes is a *protocol
 *    violation*. The decoder poisons itself (there is no way to trust the rest
 *    of the stream after the peer lied about framing) and throws
 *    FrameError('frame_too_large'). The caller must close the connection.
 */

import { Buffer } from 'node:buffer';

/** Wire protocol magic, carried in the first `hello` header. */
export const PROTO_MAGIC = 'dsh-lan-bridge/1';

/** Default accepted/emitted frame size (whole frame including 8 byte prefix). */
export const MAX_FRAME_BYTES = 8 * 1024 * 1024; // 8 MiB
/** Absolute ceiling; a config may lower maxFrameBytes but never raise past this. */
export const HARD_MAX_FRAME_BYTES = 64 * 1024 * 1024; // 64 MiB
/** Default accepted/emitted header size. */
export const MAX_HEADER_BYTES = 16 * 1024; // 16 KiB
/** Absolute ceiling for headers. */
export const HARD_MAX_HEADER_BYTES = 64 * 1024;

/** Direction tags. Used as the first AAD byte so the two directions can never
 *  be confused even if key derivation were ever mis-wired. */
export const DIR_AGENT_TO_BRIDGE = 0x41; // 'A'
export const DIR_BRIDGE_TO_AGENT = 0x42; // 'B'

const EMPTY = Buffer.alloc(0);

/** Error thrown for every framing-level violation. */
export class FrameError extends Error {
  /**
   * @param {string} code machine readable code, e.g. 'frame_too_large'
   * @param {string} [detail] human readable detail (never sent to the peer verbatim)
   * @param {{fatal?: boolean, bytes?: number}} [opts]
   */
  constructor(code, detail = '', opts = {}) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'FrameError';
    this.code = code;
    /** true when the byte stream can no longer be trusted (connection must close) */
    this.fatal = opts.fatal !== false;
    if (opts.bytes !== undefined) this.bytes = opts.bytes;
  }
}

/**
 * Encode one frame.
 * @param {object} header JSON-serialisable header object (must serialise to <= maxHeaderBytes)
 * @param {Buffer|Uint8Array|string|null} [payload] optional binary payload
 * @param {{maxFrameBytes?: number, maxHeaderBytes?: number}} [opts]
 * @returns {Buffer}
 */
export function encodeFrame(header, payload = null, opts = {}) {
  const maxFrameBytes = Math.min(opts.maxFrameBytes ?? MAX_FRAME_BYTES, HARD_MAX_FRAME_BYTES);
  const maxHeaderBytes = Math.min(opts.maxHeaderBytes ?? MAX_HEADER_BYTES, HARD_MAX_HEADER_BYTES);

  let headerBytes;
  try {
    headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  } catch (err) {
    throw new FrameError('header_not_serialisable', String(err && err.message), { fatal: false });
  }
  if (headerBytes.length === 0) throw new FrameError('header_empty', '', { fatal: false });
  if (headerBytes.length > maxHeaderBytes) {
    throw new FrameError('header_too_large', `${headerBytes.length} > ${maxHeaderBytes}`, { fatal: false });
  }

  let body = EMPTY;
  if (payload !== null && payload !== undefined) {
    body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  }

  const totalLen = 4 + headerBytes.length + body.length;
  if (totalLen > maxFrameBytes) {
    throw new FrameError('frame_too_large', `${totalLen} > ${maxFrameBytes}`, { fatal: false, bytes: totalLen });
  }

  const out = Buffer.allocUnsafe(8 + headerBytes.length + body.length);
  out.writeUInt32BE(totalLen, 0);
  out.writeUInt32BE(headerBytes.length, 4);
  headerBytes.copy(out, 8);
  if (body.length > 0) body.copy(out, 8 + headerBytes.length);
  return out;
}

/**
 * Exact number of bytes `encodeFrame` would produce. Useful for backpressure
 * accounting and for the stream credit window without building the buffer.
 */
export function frameSize(header, payloadLength = 0, opts = {}) {
  const maxHeaderBytes = Math.min(opts.maxHeaderBytes ?? MAX_HEADER_BYTES, HARD_MAX_HEADER_BYTES);
  const headerBytes = Buffer.byteLength(JSON.stringify(header), 'utf8');
  if (headerBytes > maxHeaderBytes) throw new FrameError('header_too_large', '', { fatal: false });
  return 8 + headerBytes + payloadLength;
}

/**
 * Additional Authenticated Data for an encrypted frame.
 *
 * AAD = dirByte || u32be(headerLen) || headerBytes
 *
 * The length prefix makes the AAD encoding unambiguous (header bytes could
 * otherwise contain the direction byte and be re-split), and binding the
 * cleartext header means the AEAD tag covers seq/iv/type: an attacker cannot
 * rewrite the routing metadata without breaking the tag.
 */
export function buildAAD(dirByte, headerBytes) {
  const out = Buffer.allocUnsafe(5 + headerBytes.length);
  out[0] = dirByte;
  out.writeUInt32BE(headerBytes.length, 1);
  headerBytes.copy(out, 5);
  return out;
}

/**
 * Growable FIFO byte queue with O(1) amortised append and a single copy when a
 * complete frame becomes available. `peek` may return a view (no copy) when the
 * requested bytes are contiguous inside the head chunk.
 */
export class ByteQueue {
  constructor() {
    /** @type {Buffer[]} */
    this._chunks = [];
    this._headOffset = 0;
    this.length = 0;
  }

  push(chunk) {
    if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);
    if (chunk.length === 0) return;
    this._chunks.push(chunk);
    this.length += chunk.length;
  }

  /** Drop `n` bytes. Returns the dropped bytes (copied only when needed). */
  read(n) {
    if (n > this.length) throw new FrameError('queue_underflow', `${n} > ${this.length}`);
    const head = this._chunks[0];
    const avail = head.length - this._headOffset;
    if (n <= avail) {
      const out = head.subarray(this._headOffset, this._headOffset + n);
      this._headOffset += n;
      this.length -= n;
      if (this._headOffset === head.length) {
        this._chunks.shift();
        this._headOffset = 0;
      }
      return out;
    }
    const out = Buffer.allocUnsafe(n);
    let copied = 0;
    while (copied < n) {
      const c = this._chunks[0];
      const a = c.length - this._headOffset;
      const take = Math.min(a, n - copied);
      c.copy(out, copied, this._headOffset, this._headOffset + take);
      copied += take;
      this._headOffset += take;
      if (this._headOffset === c.length) {
        this._chunks.shift();
        this._headOffset = 0;
      }
    }
    this.length -= n;
    return out;
  }

  /**
   * Return exactly `n` bytes without consuming, or null when fewer are buffered.
   * May return a view into an internal chunk: callers must not mutate it.
   */
  peek(n) {
    if (n > this.length) return null;
    const head = this._chunks[0];
    const avail = head.length - this._headOffset;
    if (n <= avail) return head.subarray(this._headOffset, this._headOffset + n);
    const out = Buffer.allocUnsafe(n);
    let copied = 0;
    let idx = 0;
    let off = this._headOffset;
    while (copied < n) {
      const c = this._chunks[idx];
      const a = c.length - off;
      const take = Math.min(a, n - copied);
      c.copy(out, copied, off, off + take);
      copied += take;
      off += take;
      if (off === c.length) { idx++; off = 0; }
    }
    return out;
  }

  clear() {
    this._chunks = [];
    this._headOffset = 0;
    this.length = 0;
  }
}

/**
 * Incremental frame parser. Handles partial reads, several frames per chunk and
 * deliberately oversized frames. Not a stream.Transform: it is a pure function
 * of (buffered bytes -> frames) so it is trivially unit-testable and cannot
 * hide errors inside stream error plumbing.
 */
export class FrameDecoder {
  constructor(opts = {}) {
    this.maxFrameBytes = Math.min(opts.maxFrameBytes ?? MAX_FRAME_BYTES, HARD_MAX_FRAME_BYTES);
    this.maxHeaderBytes = Math.min(opts.maxHeaderBytes ?? MAX_HEADER_BYTES, HARD_MAX_HEADER_BYTES);
    this.queue = new ByteQueue();
    this.poisoned = false;
    /** @type {FrameError|null} */
    this.error = null;
    this.framesDecoded = 0;
    this.bytesDecoded = 0;
    this.maxFrameSeen = 0;
    this.maxHeaderSeen = 0;
  }

  /** @returns {boolean} */
  get ok() { return !this.poisoned; }

  _fail(code, detail, opts = {}) {
    const err = new FrameError(code, detail, opts);
    this.poisoned = true;
    this.error = err;
    this.queue.clear();
    throw err;
  }

  /**
   * Feed raw socket bytes.
   * @param {Buffer} chunk
   * @returns {Array<{header: object, headerBytes: Buffer, payload: Buffer, totalLen: number, raw: Buffer}>}
   * @throws {FrameError} on any framing violation (decoder becomes poisoned)
   */
  push(chunk) {
    if (this.poisoned) {
      throw this.error ?? new FrameError('decoder_poisoned');
    }
    this.queue.push(chunk);

    const out = [];
    for (;;) {
      if (this.queue.length < 8) break; // need the fixed prefix
      const prefix = this.queue.peek(8);
      const totalLen = prefix.readUInt32BE(0);
      const headerLen = prefix.readUInt32BE(4);

      if (totalLen > this.maxFrameBytes) {
        // Refuse before allocating or buffering the rest of the frame. A peer
        // that declares 4 GiB is either broken or hostile; either way the byte
        // stream is untrustworthy (we cannot know where the next frame starts
        // if the length field is a lie), so this is fatal.
        this._fail('frame_too_large', `declared ${totalLen} > max ${this.maxFrameBytes}`,
          { bytes: totalLen });
      }
      if (headerLen === 0) this._fail('header_empty', 'headerLen == 0');
      if (headerLen > this.maxHeaderBytes) this._fail('header_too_large', `${headerLen} > ${this.maxHeaderBytes}`);
      if (totalLen < 4 + headerLen) {
        this._fail('frame_inconsistent', `totalLen ${totalLen} < 4 + headerLen ${headerLen}`);
      }
      if (this.queue.length < 4 + totalLen) break; // wait for the rest

      const raw = this.queue.read(4 + totalLen);
      const headerBytes = raw.subarray(8, 8 + headerLen);
      const payload = raw.subarray(8 + headerLen);

      let header;
      try {
        header = JSON.parse(headerBytes.toString('utf8'));
      } catch (err) {
        this._fail('header_not_json', String(err && err.message));
      }
      if (header === null || typeof header !== 'object' || Array.isArray(header)) {
        this._fail('header_not_object', Array.isArray(header) ? 'array' : typeof header);
      }

      this.framesDecoded++;
      this.bytesDecoded += raw.length;
      if (totalLen > this.maxFrameSeen) this.maxFrameSeen = totalLen;
      if (headerLen > this.maxHeaderSeen) this.maxHeaderSeen = headerLen;
      out.push({ header, headerBytes, payload, totalLen, raw });
    }
    return out;
  }

  /** Bytes buffered but not yet consumed by a complete frame. */
  get pendingBytes() { return this.queue.length; }

  /** Called when the peer closed: leftover bytes mean a truncated frame. */
  end() {
    if (this.poisoned) return null;
    if (this.queue.length !== 0) {
      const n = this.queue.length;
      this.queue.clear();
      this.poisoned = true;
      this.error = new FrameError('truncated_frame', `${n} trailing bytes`);
      throw this.error;
    }
    return null;
  }
}

/**
 * Encode a secure (encrypted) frame. The cleartext header carries only what the
 * receiver needs before decryption: type, sequence number and the nonce. Every
 * other field lives inside the ciphertext.
 *
 * @param {{seq: number, iv: Buffer, subtype?: string}} meta
 * @param {Buffer} ciphertext output of crypto.seal()
 * @param {{maxFrameBytes?: number}} [opts]
 */
export function encodeSecureFrame(meta, ciphertext, opts = {}) {
  const header = { t: 'enc', s: meta.seq >>> 0, iv: meta.iv.toString('base64url') };
  if (meta.subtype) header.st = meta.subtype;
  return encodeFrame(header, ciphertext, opts);
}

export default {
  PROTO_MAGIC,
  MAX_FRAME_BYTES,
  HARD_MAX_FRAME_BYTES,
  MAX_HEADER_BYTES,
  HARD_MAX_HEADER_BYTES,
  DIR_AGENT_TO_BRIDGE,
  DIR_BRIDGE_TO_AGENT,
  FrameError,
  encodeFrame,
  frameSize,
  buildAAD,
  ByteQueue,
  FrameDecoder,
  encodeSecureFrame,
};
