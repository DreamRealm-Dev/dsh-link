#!/usr/bin/env node
/**
 * R351/R377: the editor save route, driven directly (no web server).
 *
 * The route exists because the kernel workspace-files surface only reads; a person editing a note has to be able to
 * write it. These readings pin what makes the write narrow: POST only, an existing regular file, an optimistic
 * version check, and a write that goes through the kernel's own `fs` service instead of a temp-file dance of our own.
 *
 * R377 changed what the guard compares. The route used to recompute '<mtimeMs>-<size>' locally, while the token a
 * document carries is the one `workspaceFiles/read` returned — an opaque `FsVersion` from the fs service. Two
 * vocabularies for one fact never agree, and the live page refused EVERY save as stale. The fake service below
 * therefore reports a deliberately un-fingerprint-like token ('dev:ino:size') so a route that ever assumes a format
 * again goes red here rather than on a person's file.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const routePath = 'file:///' + join(PROJECT, 'plugins', 'dsh-link-markdown', 'lib', 'index.js').replaceAll('\\', '/')
const mod = await import(routePath)

const readings = []
const held = (name, ok, detail) => { readings.push([name, ok === true, detail]) }

function call(handler, method, body) {
  const text = body === undefined ? '' : JSON.stringify(body)
  const req = {
    method,
    on(event, fn) {
      if (event === 'data' && text !== '') fn(Buffer.from(text, 'utf8'))
      if (event === 'end') fn()
    },
  }
  let status = 0
  let payload = null
  const res = {
    setHeader() {},
    end(chunk) { payload = JSON.parse(String(chunk)) },
    get statusCode() { return status },
    set statusCode(value) { status = value },
  }
  return handler(req, res).then(() => ({ status, body: payload }))
}

const root = mkdtempSync(join(tmpdir(), 'r351-save-'))
const target = join(root, 'note.md')
writeFileSync(target, '# 原始\n', 'utf8')

// A stand-in for the kernel fs service: an opaque version token, and a version-guarded atomic replace under it.
// The token is NOT <mtimeMs>-<size> on purpose (see the header).
const tokenOf = (path) => '7:1234:' + String(readFileSync(path, 'utf8').length)
const writes = []
const service = {
  stat: async (path) => {
    try { return { version: tokenOf(path), isFile: true } } catch (error) { return null }
  },
  write: async (path, text, expected) => {
    const current = tokenOf(path)
    writes.push([path, text, expected])
    if (expected !== null && expected !== current) {
      const error = new Error('the file changed since it was read')
      error.code = 'FS_STALE_VERSION'
      throw error
    }
    const temp = path + '.fake-atomic-' + String(writes.length)
    writeFileSync(temp, text, 'utf8')
    rmSync(path, { force: true })
    writeFileSync(path, text, 'utf8')
    rmSync(temp, { force: true })
    return { version: tokenOf(path) }
  },
}

const handler = mod.createWriteHandler({ fs: service })

/** One service whose write is refused the way the kernel refuses a lost race. */
const racyHandler = mod.createWriteHandler({
  fs: { stat: service.stat, write: async () => { const error = new Error('stale under the lock'); error.code = 'FS_STALE_VERSION'; throw error } },
})

const first = await call(handler, 'POST', { path: target, text: '# 改过了\n' })
held('a save with no version (a first write) replaces the file and answers the version the service reported',
  first.status === 200 && first.body.ok === true && first.body.version === tokenOf(target) && readFileSync(target, 'utf8') === '# 改过了\n'
    && writes.length === 1 && writes[0][2] === null,
  'status=' + String(first.status) + ' version=' + String(first.body && first.body.version) + ' text=' + JSON.stringify(readFileSync(target, 'utf8')))

const stale = await call(handler, 'POST', { path: target, text: '# 抢写\n', expectedVersion: '1-1' })
held('a save whose expectedVersion is stale is REFUSED by name and the file is untouched',
  stale.status === 409 && stale.body.code === 'STALE' && readFileSync(target, 'utf8') === '# 改过了\n' && writes.length === 1,
  'status=' + String(stale.status) + ' code=' + String(stale.body && stale.body.code) + ' text=' + JSON.stringify(readFileSync(target, 'utf8')))

const fresh = await call(handler, 'POST', { path: target, text: '# 第二次\n', expectedVersion: first.body.version })
held('a save that echoes the version it read is accepted',
  fresh.status === 200 && fresh.body.ok === true && readFileSync(target, 'utf8') === '# 第二次\n',
  'status=' + String(fresh.status) + ' version=' + String(fresh.body && fresh.body.version))

// R377: the early check is readable, not authoritative — the service may still lose the race between stat and write,
// and that answer has to be the same 409 a person sees, not a 500.
const raced = await call(racyHandler, 'POST', { path: target, text: '# 并行写\n', expectedVersion: fresh.body.version })
held('a race the service loses under its own lock still answers STALE, not a server error',
  raced.status === 409 && raced.body.code === 'STALE' && readFileSync(target, 'utf8') === '# 第二次\n',
  'status=' + String(raced.status) + ' code=' + String(raced.body && raced.body.code))

// The format belongs to the service. This reading is what a route that recomputes its own fingerprint cannot pass.
held('the route compares the service token verbatim and invents no format of its own',
  mod.versionOf({ version: '7:1234:12' }) === '7:1234:12' && mod.versionOf(null) === null,
  'versionOf=' + String(mod.versionOf({ version: '7:1234:12' })))

const leftovers = readdirSync(root).filter((name) => name.indexOf('fake-atomic-') !== -1 || name.indexOf('.dsh-link-save-') !== -1)
held('the write leaves no temp file behind, and the route keeps no temp-file logic of its own',
  leftovers.length === 0 && readFileSync(join(PROJECT, 'plugins', 'dsh-link-markdown', 'lib', 'index.js'), 'utf8').indexOf('.dsh-link-save-') === -1,
  'leftovers=' + JSON.stringify(leftovers))

const missing = await call(handler, 'POST', { path: join(root, 'not-here.md'), text: 'x' })
held('the route never creates a file: a path that does not exist is refused',
  missing.status === 404 && missing.body.code === 'NO_FILE', 'status=' + String(missing.status) + ' code=' + String(missing.body && missing.body.code))

const wrongVerb = await call(handler, 'GET', undefined)
held('the route is POST only', wrongVerb.status === 405 && wrongVerb.body.code === 'METHOD_NOT_ALLOWED', 'status=' + String(wrongVerb.status))

const relative = await call(handler, 'POST', { path: 'note.md', text: 'x' })
held('a relative path is refused (this route only touches absolute paths)',
  relative.status === 400 && relative.body.code === 'BAD_PATH', 'status=' + String(relative.status) + ' code=' + String(relative.body && relative.body.code))

rmSync(root, { recursive: true, force: true })

for (const [name, ok, detail] of readings) console.log((ok ? '  ok   ' : '  RED  ') + name + ' — ' + detail)
const failed = readings.filter(([, ok]) => ok !== true).length
console.log('\n' + String(readings.length) + ' reading(s), ' + String(readings.length - failed) + ' held, ' + String(failed) + ' failed')
process.exit(failed === 0 ? 0 : 1)
