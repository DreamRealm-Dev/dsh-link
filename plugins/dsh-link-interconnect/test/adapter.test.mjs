#!/usr/bin/env node
/**
 * test/adapter.test.mjs - the declarative adapter runtime, the models/tools bindings and the OFM
 * stand-in, driven end to end in-process: real HTTP on ephemeral loopback ports, a fake
 * InterconnectCore, a fake kernel llm registry and a fake tools registry that record everything.
 *
 * Run with the bundled tsx from the kernel checkout:
 *   cd core/deepseek-harness
 *   node --import tsx/esm <absolute path to this file>
 *
 * Readings: the four honest probe reasons, the consent-before-credential order (the forward key
 * is rotated AT consent time and the stub accepts only the post-consent key), binding active with
 * the provider registered, listModels, streamed deltas in the kernel chunk vocabulary, a tool
 * registered and invoked through the peer, adapters.json carrying no credential, named refusals
 * for consent denial and failed verification with full rollback, restart restore, disconnect and
 * unavailable disposal.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAdapterRuntime } from '../src/adapters/runtime.ts'
import { bindModels, createOpenAiCompatibleAdapter } from '../src/bind/models.ts'
import { bindTools } from '../src/bind/tools.ts'
import { probeDeclaration } from '../src/adapters/probe.ts'
import { startOfmStub } from '../../../scripts/ofm-stub.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = dirname(HERE)
const OFM_DECLARATION = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'adapters', 'ofm', 'adapter.json'), 'utf8'))

let held = 0
let failed = 0
const check = (label, condition, detail) => {
  if (condition) {
    held += 1
    console.log('ok   ' + label)
  } else {
    failed += 1
    console.log('FAIL ' + label + (detail === undefined ? '' : ': ' + detail))
  }
}
const equal = (label, actual, expected) => {
  const left = JSON.stringify(actual)
  const right = JSON.stringify(expected)
  check(label + ' == ' + right, left === right, 'actual ' + left)
}
const includes = (label, haystack, needle) => check(label + ' contains ' + JSON.stringify(needle), String(haystack).includes(needle), String(haystack).slice(0, 240))
const excludes = (label, haystack, needle) => check(label + ' omits ' + JSON.stringify(needle), !String(haystack).includes(needle), String(haystack).slice(0, 240))

const listen = async (server) => {
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolvePromise()
    })
  })
  return server.address().port
}
const closeServer = async (server) => {
  await new Promise((resolvePromise) => {
    server.close(() => resolvePromise())
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
  })
}
const reserveClosedPort = async () => {
  const server = createServer()
  const port = await listen(server)
  await closeServer(server)
  return port
}

/** One fake InterconnectCore: the runtime only reads dir/log/consent/events/audit, and grants for peer restore. */
function createFakeCore(dir, decide, grantCheck) {
  const logs = []
  const audit = []
  const events = []
  const consentRequests = []
  const listeners = new Set()
  const core = {
    protocol: 'link-interconnect/1',
    dir,
    log(line) { logs.push(String(line)) },
    identity: {},
    tokens: {},
    peers: {},
    grants: {
      get() { return undefined },
      list() { return [] },
      grant(grant) { return grant },
      revoke() { return false },
      has(peerLinkId, scope) { return typeof grantCheck === 'function' ? grantCheck(peerLinkId, scope) : true },
    },
    consent: {
      async request(input) {
        consentRequests.push({ ...input })
        return typeof decide === 'function' ? decide(input) : 'granted'
      },
      listPending() { return [] },
      decide() { return false },
      async awaitDecision() { return 'granted' },
    },
    events: {
      publish(event) {
        events.push(event)
        for (const listener of [...listeners]) {
          try {
            listener(event)
          } catch (error) {
            logs.push('event listener failed: ' + (error instanceof Error ? error.message : String(error)))
          }
        }
      },
      subscribe(listener) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      recent() { return [...events] },
    },
    audit: {
      record(record) { audit.push({ at: new Date().toISOString(), ...record }) },
      list() { return [...audit] },
    },
  }
  return { core, logs, audit, events, consentRequests }
}

/** One fake host world: a kernel-shaped llm registry and tools registry, both recording. */
function createFakeHosts() {
  const adapters = new Map()
  const definitions = new Map()
  const llm = {
    registerAdapter(providers, adapter) {
      for (const provider of providers) {
        if (adapters.has(provider)) throw new Error('an adapter for provider ' + JSON.stringify(provider) + ' is already registered')
      }
      for (const provider of providers) adapters.set(provider, adapter)
      let released = false
      const handle = () => {
        if (released) return
        released = true
        for (const provider of providers) if (adapters.get(provider) === adapter) adapters.delete(provider)
      }
      handle.replace = () => {}
      return handle
    },
    listProviders() { return [...adapters.keys()].map((id) => ({ id, name: id })) },
    listModels(provider) { return adapters.get(provider).listModels(provider) },
    stream(options) { return adapters.get(options.provider).stream(options) },
  }
  const tools = {
    register(definition) {
      if (definitions.has(definition.name)) throw new Error('tool ' + JSON.stringify(definition.name) + ' is already registered')
      definitions.set(definition.name, definition)
      return () => { definitions.delete(definition.name) }
    },
  }
  return { hosts: { llm: () => llm, tools: () => tools }, llm, tools, adapters, definitions }
}

const root = mkdtempSync(join(tmpdir(), 'dsh-link-adapter-test-'))
const previousUserProfile = process.env.USERPROFILE
const previousHome = process.env.HOME
const home = join(root, 'home')
mkdirSync(home, { recursive: true })
process.env.USERPROFILE = home
process.env.HOME = home
const ofmDataDir = join(home, '.our-free-model')
const rotatedKey = 'rotated-after-consent'
const preConsentKey = 'initial-before-consent'

let stub
let stubClosed = false
let runtime
let disposeModels
let disposeTools
const closeStub = async () => {
  if (stubClosed || stub === undefined) return
  stubClosed = true
  await stub.close()
}

try {
  stub = await startOfmStub({ port: 0, dataDir: ofmDataDir, forwardKey: preConsentKey, silent: true })
  console.log('stub  http://127.0.0.1:' + stub.port + ' (pre-consent forward key on disk)')

  // ---- 1. honest probe readings -----------------------------------------------------------
  const emptyHome = join(root, 'empty-home')
  mkdirSync(emptyHome, { recursive: true })
  const notInstalled = await probeDeclaration(OFM_DECLARATION, { home: emptyHome, env: {} })
  equal('probe not-installed reasonCode', notInstalled.reasonCode, 'not-installed')
  check('probe not-installed is not detected', notInstalled.detected === false)
  includes('probe not-installed reason names the lock file', notInstalled.reason, 'service.lock')

  const closedPort = await reserveClosedPort()
  const stoppedHome = join(root, 'stopped-home')
  mkdirSync(join(stoppedHome, '.our-free-model'), { recursive: true })
  writeFileSync(join(stoppedHome, '.our-free-model', 'service.lock'), JSON.stringify({ port: closedPort }))
  const notRunning = await probeDeclaration(OFM_DECLARATION, { home: stoppedHome, env: {} })
  equal('probe not-running reasonCode', notRunning.reasonCode, 'not-running')
  includes('probe not-running reason names the port', notRunning.reason, String(closedPort))

  const foreignServer = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ product: 'some-other-service', name: 'Not OFM' }))
  })
  const foreignPort = await listen(foreignServer)
  const foreignHome = join(root, 'foreign-home')
  mkdirSync(join(foreignHome, '.our-free-model'), { recursive: true })
  writeFileSync(join(foreignHome, '.our-free-model', 'service.lock'), JSON.stringify({ port: foreignPort }))
  const foreignReading = await probeDeclaration(OFM_DECLARATION, { home: foreignHome, env: {} })
  equal('probe foreign-service reasonCode', foreignReading.reasonCode, 'foreign-service')
  includes('probe foreign-service reason says foreign', foreignReading.reason, 'foreign')
  await closeServer(foreignServer)

  const malformedHome = join(root, 'malformed-home')
  mkdirSync(join(malformedHome, '.our-free-model'), { recursive: true })
  writeFileSync(join(malformedHome, '.our-free-model', 'service.lock'), 'this is not json')
  const malformed = await probeDeclaration(OFM_DECLARATION, { home: malformedHome, env: {} })
  equal('probe malformed lock reasonCode', malformed.reasonCode, 'probe-failed')

  const detected = await probeDeclaration(OFM_DECLARATION, { home, env: {} })
  check('probe detected the running stub', detected.detected === true, JSON.stringify(detected))
  equal('probe detected baseUrl', detected.baseUrl, 'http://127.0.0.1:' + stub.port)

  // ---- 2. the world: declarations, locks, fake core and hosts ------------------------------
  const adaptersDir = join(root, 'adapters')
  const writeAdapter = (id, declaration) => {
    mkdirSync(join(adaptersDir, id), { recursive: true })
    writeFileSync(join(adaptersDir, id, 'adapter.json'), JSON.stringify(declaration, null, 2))
  }
  writeAdapter('ofm', OFM_DECLARATION)
  const peerIdentity = { method: 'GET', url: 'http://127.0.0.1:{port}/health', contains: 'link-test-peer' }
  writeAdapter('fake-peer', {
    id: 'fake-peer',
    name: 'Fake Peer',
    match: { files: [{ path: '~/.link-test-peer/port.json', jsonPath: 'port', as: 'port' }], identity: peerIdentity },
    connect: { baseUrl: 'http://127.0.0.1:{port}', credential: { kind: 'none' }, verify: [{ method: 'GET', path: '/health', expectStatus: 200 }] },
    capabilities: [{
      kind: 'tools.expose',
      version: 1,
      tools: [{
        name: 'echo.ping',
        description: 'Echo one string through the peer',
        parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        call: { cap: 'tools.expose', op: 'echo.ping' },
      }],
    }],
    consent: { title: '接入 Fake Peer 的工具', scopes: ['tools.expose'] },
  })
  writeAdapter('denied-peer', {
    id: 'denied-peer',
    name: 'Denied Peer',
    match: { files: [{ path: '~/.link-denied/port.json', jsonPath: 'port', as: 'port' }], identity: peerIdentity },
    connect: { baseUrl: 'http://127.0.0.1:{port}', credential: { kind: 'none' }, verify: [{ method: 'GET', path: '/health', expectStatus: 200 }] },
    capabilities: [{ kind: 'tools.expose', version: 1, tools: [{ name: 'denied.ping', description: 'Never registered', parameters: { type: 'object' } }] }],
    consent: { title: '接入 Denied Peer', scopes: ['tools.expose'] },
  })
  writeAdapter('broken', {
    id: 'broken',
    name: 'Broken Credential Peer',
    match: { files: [{ path: '~/.link-broken/port.json', jsonPath: 'port', as: 'port' }], identity: peerIdentity },
    connect: {
      baseUrl: 'http://127.0.0.1:{port}',
      credential: { kind: 'file-json', path: '~/.link-broken/settings.json', jsonPath: 'forwardKey' },
      verify: [{ method: 'GET', path: '/v1/models', expectStatus: 200, auth: 'bearer' }],
    },
    capabilities: [{ kind: 'models.provide', version: 1, from: 'openai', as: { providerId: 'broken-provider' } }],
    consent: { title: '接入 Broken Credential Peer', scopes: ['models.provide'] },
  })
  writeAdapter('invalid', { id: 'invalid', name: 'Invalid Declaration' })
  for (const [directory, port] of [['.link-test-peer', stub.port], ['.link-denied', stub.port], ['.link-broken', stub.port]]) {
    mkdirSync(join(home, directory), { recursive: true })
    writeFileSync(join(home, directory, 'port.json'), JSON.stringify({ port }))
  }
  writeFileSync(join(home, '.link-broken', 'settings.json'), JSON.stringify({ forwardKey: 'wrong-key' }))

  const decide = (input) => {
    if (input.peerName === 'Denied Peer') return 'denied'
    if (input.peerName === 'Our Free Model') {
      writeFileSync(join(ofmDataDir, 'settings.json'), JSON.stringify({ forwardKey: rotatedKey }, null, 2))
      stub.setForwardKey(rotatedKey)
    }
    return 'granted'
  }
  const dataDir = join(root, 'data')
  const fake = createFakeCore(dataDir, decide)
  const logSink = (line) => fake.logs.push(String(line))
  const hostsWorld = createFakeHosts()
  runtime = await createAdapterRuntime({ core: fake.core, adaptersDir, hosts: hostsWorld.hosts, log: logSink })
  disposeModels = bindModels({ core: fake.core, runtime, hosts: hostsWorld.hosts, log: logSink })
  disposeTools = bindTools({ core: fake.core, runtime, hosts: hostsWorld.hosts, log: logSink })

  const bootRows = runtime.adapters()
  const brokenBootRow = bootRows.find((row) => row.id === 'invalid')
  check('adapter rows carry the boot probe reason before any explicit probeAll', brokenBootRow !== undefined && brokenBootRow.reasonCode === 'probe-failed' && String(brokenBootRow.reason).includes('adapter.json'), JSON.stringify(brokenBootRow))
  const ofmBootRow = bootRows.find((row) => row.id === 'ofm')
  check('adapter rows carry the boot detection reading', ofmBootRow !== undefined && ofmBootRow.detected === true, JSON.stringify(ofmBootRow))

  const notInstalledHome = join(root, 'not-installed-home')
  mkdirSync(notInstalledHome, { recursive: true })
  const adaptersNotInstalled = join(root, 'adapters-not-installed')
  mkdirSync(join(adaptersNotInstalled, 'ofm'), { recursive: true })
  writeFileSync(join(adaptersNotInstalled, 'ofm', 'adapter.json'), JSON.stringify(OFM_DECLARATION))
  process.env.USERPROFILE = notInstalledHome
  process.env.HOME = notInstalledHome
  const fakeQuiet = createFakeCore(join(root, 'data-not-installed'), () => 'granted')
  const runtimeQuiet = await createAdapterRuntime({ core: fakeQuiet.core, adaptersDir: adaptersNotInstalled, hosts: createFakeHosts().hosts, log: fakeQuiet.core.log })
  const quietRow = runtimeQuiet.adapters()[0]
  equal('a not-installed adapter row names its reason at mount', quietRow.reasonCode, 'not-installed')
  check('a not-installed adapter row keeps the verbatim sentence', String(quietRow.reason).includes('service.lock'), String(quietRow.reason))
  runtimeQuiet.stop()
  process.env.USERPROFILE = home
  process.env.HOME = home

  const readings = await runtime.probeAll()
  const byId = new Map(readings.map((reading) => [reading.adapterId, reading]))
  equal('probeAll reads every declared adapter', readings.length, 5)
  check('runtime probe detected ofm', byId.get('ofm').detected === true)
  check('runtime probe detected fake-peer', byId.get('fake-peer').detected === true)
  equal('runtime probe failed the broken declaration', byId.get('invalid').reasonCode, 'probe-failed')
  const invalidRow = runtime.adapters().find((row) => row.id === 'invalid')
  check('adapter row carries the verbatim declaration problem', invalidRow !== undefined && String(invalidRow.reason).includes('adapter.json'), invalidRow === undefined ? 'no row' : String(invalidRow.reason))
  check('probe round published interconnect/adapters', fake.events.filter((event) => event.type === 'interconnect/adapters').length >= 1)

  // ---- 3. connect OFM: probe -> identify -> consent -> credential -> verify -> bind ---------
  const ofmBinding = await runtime.connect('ofm')
  equal('ofm binding status', ofmBinding.status, 'active')
  equal('ofm binding providerId', ofmBinding.providerId, 'our-free-model')
  equal('ofm binding caps', ofmBinding.caps, ['models.provide'])
  equal('ofm binding baseUrl', ofmBinding.baseUrl, 'http://127.0.0.1:' + stub.port)
  check('llm host received registerAdapter([our-free-model])', hostsWorld.adapters.has('our-free-model'))
  const ofmConsent = fake.consentRequests.find((request) => request.peerName === 'Our Free Model')
  check('a consent card was requested before any credential read', ofmConsent !== undefined)
  equal('consent scopes', ofmConsent === undefined ? null : ofmConsent.scopes, ['models.provide'])
  check('every request the stub saw used the post-consent key', stub.state.authorizations.length >= 1 && stub.state.authorizations.every((value) => value === 'Bearer ' + rotatedKey), JSON.stringify(stub.state.authorizations))
  check('the pre-consent key was never used', !stub.state.authorizations.includes('Bearer ' + preConsentKey), JSON.stringify(stub.state.authorizations))
  const models = await hostsWorld.llm.listModels('our-free-model')
  equal('listModels ids', models.map((model) => model.id), ['our-free-model', 'our-free-model-mini'])
  const chunks = []
  for await (const chunk of hostsWorld.llm.stream({ provider: 'our-free-model', model: 'our-free-model', messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] })) chunks.push(chunk)
  equal('stream chunk order', chunks.map((chunk) => chunk.type), ['block-start', 'text-delta', 'text-delta', 'text-delta', 'text-delta', 'text-delta', 'usage', 'block-end', 'finish'])
  equal('streamed text from the stub', chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join(''), 'Hello from the OFM stub!')
  const usageChunk = chunks.find((chunk) => chunk.type === 'usage')
  equal('stream usage', usageChunk === undefined ? null : usageChunk.usage, { inputTokens: 7, outputTokens: 5, totalTokens: 12 })
  const finishChunk = chunks[chunks.length - 1]
  check('stream finished with a stop reason', finishChunk.type === 'finish' && finishChunk.reason.kind === 'stop', JSON.stringify(finishChunk))
  const chatRequest = stub.state.chatRequests[0]
  check('the stub saw the projected OpenAI chat request', chatRequest !== undefined && chatRequest.model === 'our-free-model' && chatRequest.messages[0].role === 'user' && chatRequest.messages[0].content === 'hello', JSON.stringify(chatRequest))

  const statePath = join(dataDir, 'adapters.json')
  check('adapters.json was written', existsSync(statePath))
  const stateText = readFileSync(statePath, 'utf8')
  includes('adapters.json records the ofm binding', stateText, '"ofm"')
  excludes('adapters.json carries no credential', stateText, rotatedKey)
  excludes('adapters.json carries no pre-consent key', stateText, preConsentKey)
  const evidence = JSON.stringify(fake.logs) + JSON.stringify(fake.audit) + JSON.stringify(fake.events)
  excludes('log, audit and event text carry no credential', evidence, rotatedKey)
  const bindingEvents = fake.events.filter((event) => event.type === 'interconnect/bindings')
  check('binding change published interconnect/bindings', bindingEvents.length >= 1 && Array.isArray(bindingEvents[bindingEvents.length - 1].data.bindings))

  const persistedDocument = JSON.parse(readFileSync(statePath, 'utf8'))
  equal('adapters.json is version 2 (consent receipts)', persistedDocument.version, 2)
  const persistedOfm = persistedDocument.bindings.find((binding) => binding.adapterId === 'ofm')
  check('the receipt records the granted scopes', persistedOfm !== undefined && JSON.stringify(persistedOfm.receipt.scopes) === JSON.stringify(['models.provide']), JSON.stringify(persistedOfm))
  check('the receipt records the declaration id', persistedOfm !== undefined && persistedOfm.receipt.declarationId === 'ofm', JSON.stringify(persistedOfm && persistedOfm.receipt))
  check('the receipt records a declaration version', persistedOfm !== undefined && typeof persistedOfm.receipt.declarationVersion === 'string' && /^[0-9a-f]{16}$/.test(persistedOfm.receipt.declarationVersion), JSON.stringify(persistedOfm && persistedOfm.receipt))
  check('the receipt records the consent time', persistedOfm !== undefined && typeof persistedOfm.receipt.consentGrantedAt === 'string' && persistedOfm.receipt.consentGrantedAt !== '', JSON.stringify(persistedOfm && persistedOfm.receipt))

  // ---- 4. tools.expose: register + invoke + disconnect -------------------------------------
  await runtime.connect('fake-peer')
  check('echo.ping was registered with the tools host', hostsWorld.definitions.has('echo.ping'))
  const definition = hostsWorld.definitions.get('echo.ping')
  check('registered tool declares an output projection', definition !== undefined && typeof definition.output.render === 'function' && definition.output.schema.type === 'object')
  const toolResult = await definition.execute({ text: 'ping' }, { signal: new AbortController().signal })
  equal('tool invoke reached the peer and returned its result', toolResult, { echo: 'ping', cap: 'tools.expose', op: 'echo.ping' })
  check('the peer received the declared cap and op', stub.state.invokeRequests.length >= 1 && stub.state.invokeRequests[stub.state.invokeRequests.length - 1].cap === 'tools.expose' && stub.state.invokeRequests[stub.state.invokeRequests.length - 1].op === 'echo.ping', JSON.stringify(stub.state.invokeRequests))
  await runtime.disconnect('fake-peer')
  check('disconnect disposed the tool registration', !hostsWorld.definitions.has('echo.ping'))
  excludes('disconnect removed the persisted row', readFileSync(statePath, 'utf8'), '"fake-peer"')
  let notBoundError
  try {
    await runtime.disconnect('fake-peer')
  } catch (error) {
    notBoundError = error
  }
  check('a second disconnect refuses by name', notBoundError !== undefined && notBoundError.code === 'adapter/not-bound', String(notBoundError && notBoundError.message))
  await runtime.connect('fake-peer')
  check('reconnecting restored the tool registration', hostsWorld.definitions.has('echo.ping'))

  // ---- 5. refusals: consent denial and failed verification, both rolled back ---------------
  let deniedError
  try {
    await runtime.connect('denied-peer')
  } catch (error) {
    deniedError = error
  }
  check('consent denial refuses by name', deniedError !== undefined && deniedError.code === 'adapter/consent-denied', String(deniedError && deniedError.message))
  check('a denied peer registered no tool', !hostsWorld.definitions.has('denied.ping'))
  check('a denied peer left no binding', runtime.bindings().every((binding) => binding.adapterId !== 'denied-peer'))

  let brokenError
  try {
    await runtime.connect('broken')
  } catch (error) {
    brokenError = error
  }
  check('a rejected credential refuses verify-failed', brokenError !== undefined && brokenError.code === 'adapter/verify-failed', String(brokenError && brokenError.message))
  excludes('the verify refusal carries no credential', String(brokenError && brokenError.message), 'wrong-key')
  check('the failed binding registered no provider', !hostsWorld.adapters.has('broken-provider'))
  check('the failed binding left no state row', runtime.bindings().every((binding) => binding.adapterId !== 'broken'))
  excludes('adapters.json has no failed binding', readFileSync(statePath, 'utf8'), '"broken"')
  check('the failed verification was audited by name', fake.audit.some((record) => record.code === 'adapter/verify-failed'))

  // ---- 5b. createOpenAiCompatibleAdapter: the same provider path over explicit options -----
  const factoryAdapter = createOpenAiCompatibleAdapter({ providerId: 'factory-provider', label: 'Factory Provider', baseUrl: stub.url, apiKey: rotatedKey, timeoutMs: 5000 })
  equal('createOpenAiCompatibleAdapter providerInfo', factoryAdapter.providerInfo('factory-provider'), { id: 'factory-provider', name: 'Factory Provider' })
  const modelsRequestsBeforeFactory = stub.state.modelsRequests
  const factoryModels = await factoryAdapter.listModels('factory-provider')
  equal('createOpenAiCompatibleAdapter listModels', factoryModels.map((model) => model.id), ['our-free-model', 'our-free-model-mini'])
  check('createOpenAiCompatibleAdapter listModels used GET /v1/models', stub.state.modelsRequests === modelsRequestsBeforeFactory + 1)
  const factoryChunks = []
  for await (const chunk of factoryAdapter.stream({ provider: 'factory-provider', model: 'our-free-model', messages: [{ role: 'user', content: [{ type: 'text', text: 'factory' }] }] })) factoryChunks.push(chunk)
  equal('createOpenAiCompatibleAdapter stream text', factoryChunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join(''), 'Hello from the OFM stub!')
  equal('createOpenAiCompatibleAdapter chunk order', factoryChunks.map((chunk) => chunk.type), ['block-start', 'text-delta', 'text-delta', 'text-delta', 'text-delta', 'text-delta', 'usage', 'block-end', 'finish'])

  const staticRequestsBefore = stub.state.modelsRequests
  const staticAdapter = createOpenAiCompatibleAdapter({ providerId: 'static-provider', baseUrl: stub.url, apiKey: rotatedKey, models: ['static-a', { id: 'static-b', name: 'Static B' }] })
  equal('static catalog listModels', await staticAdapter.listModels('static-provider'), [
    { provider: 'static-provider', id: 'static-a', name: 'static-a' },
    { provider: 'static-provider', id: 'static-b', name: 'Static B' },
  ])
  check('static catalog listModels did not call /v1/models', stub.state.modelsRequests === staticRequestsBefore)
  equal('static catalog resolveModel', await staticAdapter.resolveModel('static-provider', 'static-b'), { provider: 'static-provider', id: 'static-b', name: 'Static B' })

  let factoryUrlError
  try {
    createOpenAiCompatibleAdapter({ providerId: 'x', baseUrl: 'not-a-url', apiKey: 'k' })
  } catch (error) {
    factoryUrlError = error
  }
  check('createOpenAiCompatibleAdapter refuses a bad baseUrl by name', factoryUrlError !== undefined && String(factoryUrlError.message).includes('baseUrl'), String(factoryUrlError))
  let factoryKeyError
  try {
    createOpenAiCompatibleAdapter({ providerId: 'x', baseUrl: stub.url, apiKey: '   ' })
  } catch (error) {
    factoryKeyError = error
  }
  check('createOpenAiCompatibleAdapter refuses an empty apiKey by name', factoryKeyError !== undefined && String(factoryKeyError.message).includes('apiKey'), String(factoryKeyError))

  // ---- 5c. external (peer) bindings through the same frozen event + adapters.json -----------
  const externalEventsBefore = fake.events.length
  const externalBinding = runtime.registerExternalBinding({ id: 'peer:svc_echo:models', adapterId: 'peer-svc-echo', peerLinkId: 'svc_echo_01', caps: ['models.provide'], baseUrl: stub.url, providerId: 'peer-model', apiKey: rotatedKey })
  equal('registerExternalBinding status', externalBinding.status, 'active')
  equal('registerExternalBinding peerLinkId', externalBinding.peerLinkId, 'svc_echo_01')
  equal('registerExternalBinding providerId', externalBinding.providerId, 'peer-model')
  check('a peer model binding registered its provider through the runtime path', hostsWorld.adapters.has('peer-model'))
  equal('the peer provider listModels', (await hostsWorld.llm.listModels('peer-model')).map((model) => model.id), ['our-free-model', 'our-free-model-mini'])
  const externalChunks = []
  for await (const chunk of hostsWorld.llm.stream({ provider: 'peer-model', model: 'our-free-model', messages: [{ role: 'user', content: [{ type: 'text', text: 'peer' }] }] })) externalChunks.push(chunk)
  equal('the peer provider stream text', externalChunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join(''), 'Hello from the OFM stub!')
  const externalEvent = fake.events.slice(externalEventsBefore).filter((event) => event.type === 'interconnect/bindings').pop()
  check('registerExternalBinding published interconnect/bindings', externalEvent !== undefined && externalEvent.data.bindings.some((binding) => binding.id === 'peer:svc_echo:models'), JSON.stringify(externalEvent && externalEvent.data))
  const externalStateText = readFileSync(statePath, 'utf8')
  includes('adapters.json persists the peer binding', externalStateText, '"peerLinkId": "svc_echo_01"')
  excludes('adapters.json carries no peer token', externalStateText, rotatedKey)
  const externalPersisted = JSON.parse(externalStateText).bindings.find((binding) => binding.id === 'peer:svc_echo:models')
  check('the persisted peer binding has no consent receipt', externalPersisted !== undefined && externalPersisted.external === true && externalPersisted.receipt === undefined && externalPersisted.peerLinkId === 'svc_echo_01', JSON.stringify(externalPersisted))
  runtime.releaseExternalBinding('peer:svc_echo:models')
  check('releaseExternalBinding disposed the peer provider', !hostsWorld.adapters.has('peer-model'))
  excludes('releaseExternalBinding removed the persisted peer row', readFileSync(statePath, 'utf8'), '"peer:svc_echo:models"')
  const releaseEvent = fake.events.filter((event) => event.type === 'interconnect/bindings').pop()
  check('releaseExternalBinding published the bindings event without the peer binding', releaseEvent !== undefined && releaseEvent.data.bindings.every((binding) => binding.id !== 'peer:svc_echo:models'))
  let externalReleaseError
  try {
    runtime.releaseExternalBinding('peer:svc_echo:models')
  } catch (error) {
    externalReleaseError = error
  }
  check('releasing an unknown peer binding refuses by name', externalReleaseError !== undefined && externalReleaseError.code === 'adapter/external-unknown', String(externalReleaseError && externalReleaseError.message))

  const providerCountBeforeNoToken = hostsWorld.adapters.size
  runtime.registerExternalBinding({ id: 'peer:svc_nokey:models', adapterId: 'peer-svc-nokey', peerLinkId: 'svc_nokey', caps: ['models.provide'], baseUrl: stub.url, providerId: 'peer-nokey-provider' })
  check('a peer binding without a token leaves its provider to the ingress', !hostsWorld.adapters.has('peer-nokey-provider') && hostsWorld.adapters.size === providerCountBeforeNoToken)
  check('the token skip is logged honestly', fake.logs.some((line) => line.includes('leaves provider') && line.includes('peer-nokey-provider')))
  let disconnectPeerError
  try {
    await runtime.disconnect('peer:svc_nokey:models')
  } catch (error) {
    disconnectPeerError = error
  }
  check('disconnect refuses a peer binding by name', disconnectPeerError !== undefined && disconnectPeerError.code === 'adapter/external-unknown', String(disconnectPeerError && disconnectPeerError.message))
  runtime.releaseExternalBinding('peer:svc_nokey:models')

  runtime.registerExternalBinding({ id: 'peer:dup', adapterId: 'peer-dup', peerLinkId: 'svc_dup', caps: ['tools.expose'], baseUrl: stub.url })
  let duplicateError
  try {
    runtime.registerExternalBinding({ id: 'peer:dup', adapterId: 'peer-dup-2', peerLinkId: 'svc_dup', caps: ['tools.expose'], baseUrl: stub.url })
  } catch (error) {
    duplicateError = error
  }
  check('a duplicate peer binding id refuses by name', duplicateError !== undefined && duplicateError.code === 'adapter/external-conflict', String(duplicateError && duplicateError.message))
  runtime.releaseExternalBinding('peer:dup')

  // ---- 5d. peer bindings restore against the grant store ------------------------------------
  const peerRestoreDataDir = join(root, 'data-peer-restore')
  const fakePeerA = createFakeCore(peerRestoreDataDir, () => 'granted', () => true)
  const runtimePeerA = await createAdapterRuntime({ core: fakePeerA.core, adaptersDir, hosts: createFakeHosts().hosts, log: fakePeerA.core.log })
  runtimePeerA.registerExternalBinding({ id: 'peer:restore', adapterId: 'peer-restore', peerLinkId: 'svc_restore', caps: ['tools.expose'], baseUrl: stub.url })
  runtimePeerA.registerExternalBinding({ id: 'peer:revoked', adapterId: 'peer-revoked', peerLinkId: 'svc_revoked', caps: ['tools.expose'], baseUrl: stub.url })
  runtimePeerA.stop()
  const fakePeerB = createFakeCore(peerRestoreDataDir, () => 'granted', () => true)
  const runtimePeerB = await createAdapterRuntime({ core: fakePeerB.core, adaptersDir, hosts: createFakeHosts().hosts, log: fakePeerB.core.log })
  equal('peer bindings restore rejoin-required while their grants are on record', runtimePeerB.bindings().map((binding) => [binding.id, binding.status]), [['peer:restore', 'rejoin-required'], ['peer:revoked', 'rejoin-required']])
  check('the peer restore is audited as rejoin-required', fakePeerB.audit.some((record) => record.code === 'rejoin-required' && String(record.detail).includes('peer session token')))
  const reestablished = runtimePeerB.registerExternalBinding({ id: 'peer:restore', adapterId: 'peer-restore', peerLinkId: 'svc_restore', caps: ['tools.expose'], baseUrl: stub.url })
  equal('a rejoin-required peer binding is replaced when its session is re-established', reestablished.status, 'active')
  runtimePeerB.releaseExternalBinding('peer:restore')
  runtimePeerB.stop()
  const fakePeerC = createFakeCore(peerRestoreDataDir, () => 'granted', () => false)
  const runtimePeerC = await createAdapterRuntime({ core: fakePeerC.core, adaptersDir, hosts: createFakeHosts().hosts, log: fakePeerC.core.log })
  equal('a revoked grant drops the persisted peer binding', runtimePeerC.bindings().map((binding) => binding.id), [])
  check('the revoked peer binding is audited by name', fakePeerC.audit.some((record) => record.code === 'peer-binding-revoked'))
  runtimePeerC.stop()

  // ---- 6. restart restore from adapters.json ----------------------------------------------
  const fakeRestart = createFakeCore(dataDir, () => 'granted')
  const hostsRestart = createFakeHosts()
  const runtimeRestart = await createAdapterRuntime({ core: fakeRestart.core, adaptersDir, hosts: hostsRestart.hosts, log: fakeRestart.core.log })
  const restored = runtimeRestart.bindings()
  equal('restart restored both persisted bindings', restored.length, 2)
  check('restart restored them active', restored.every((binding) => binding.status === 'active'), JSON.stringify(restored))
  const disposeModelsRestart = bindModels({ core: fakeRestart.core, runtime: runtimeRestart, hosts: hostsRestart.hosts, log: fakeRestart.core.log })
  const disposeToolsRestart = bindTools({ core: fakeRestart.core, runtime: runtimeRestart, hosts: hostsRestart.hosts, log: fakeRestart.core.log })
  check('restart re-registered the model provider', hostsRestart.adapters.has('our-free-model'))
  check('restart re-registered the tool', hostsRestart.definitions.has('echo.ping'))
  disposeModelsRestart()
  disposeToolsRestart()
  runtimeRestart.stop()

  // ---- 6b. a stale receipt: the declaration changed after the grant refuses restore --------
  const changedAdaptersDir = join(root, 'adapters-changed')
  mkdirSync(join(changedAdaptersDir, 'ofm'), { recursive: true })
  writeFileSync(join(changedAdaptersDir, 'ofm', 'adapter.json'), JSON.stringify(OFM_DECLARATION, null, 2))
  const changedDataDir = join(root, 'data-changed')
  const fakeBefore = createFakeCore(changedDataDir, () => 'granted')
  const hostsBefore = createFakeHosts()
  const runtimeBefore = await createAdapterRuntime({ core: fakeBefore.core, adaptersDir: changedAdaptersDir, hosts: hostsBefore.hosts, log: fakeBefore.core.log })
  const disposeModelsBefore = bindModels({ core: fakeBefore.core, runtime: runtimeBefore, hosts: hostsBefore.hosts, log: fakeBefore.core.log })
  await runtimeBefore.connect('ofm')
  check('the unchanged declaration bound active before the edit', runtimeBefore.bindings().some((binding) => binding.adapterId === 'ofm' && binding.status === 'active'))
  disposeModelsBefore()
  runtimeBefore.stop()
  const renamedDeclaration = JSON.parse(JSON.stringify(OFM_DECLARATION))
  renamedDeclaration.name = 'Our Free Model Renamed'
  writeFileSync(join(changedAdaptersDir, 'ofm', 'adapter.json'), JSON.stringify(renamedDeclaration, null, 2))
  const fakeAfter = createFakeCore(changedDataDir, () => 'granted')
  const hostsAfter = createFakeHosts()
  const runtimeAfter = await createAdapterRuntime({ core: fakeAfter.core, adaptersDir: changedAdaptersDir, hosts: hostsAfter.hosts, log: fakeAfter.core.log })
  equal('a declaration changed after the grant restores rejoin-required', runtimeAfter.bindings().map((binding) => binding.status), ['rejoin-required'])
  const disposeModelsAfter = bindModels({ core: fakeAfter.core, runtime: runtimeAfter, hosts: hostsAfter.hosts, log: fakeAfter.core.log })
  check('a rejoin-required binding registered no provider', hostsAfter.adapters.size === 0, String(hostsAfter.adapters.size))
  check('the stale declaration version is named in the audit', fakeAfter.audit.some((record) => record.code === 'rejoin-required' && String(record.detail).includes('declaration changed')), JSON.stringify(fakeAfter.audit.filter((record) => record.code === 'rejoin-required')))
  disposeModelsAfter()
  runtimeAfter.stop()

  // ---- 6c. a revoked receipt and a legacy (version 1) receipt both refuse restore ----------
  const revokedDataDir = join(root, 'data-revoked')
  mkdirSync(revokedDataDir, { recursive: true })
  writeFileSync(join(revokedDataDir, 'adapters.json'), JSON.stringify({
    version: 2,
    bindings: [{
      adapterId: 'ofm',
      caps: ['models.provide'],
      baseUrl: 'http://127.0.0.1:' + stub.port,
      boundAt: new Date().toISOString(),
      receipt: {
        adapterId: 'ofm',
        scopes: ['models.provide'],
        consentGrantedAt: new Date().toISOString(),
        declarationId: 'ofm',
        declarationVersion: '0000000000000000',
        revokedAt: new Date().toISOString(),
      },
    }],
  }))
  const fakeRevoked = createFakeCore(revokedDataDir, () => 'granted')
  const runtimeRevoked = await createAdapterRuntime({ core: fakeRevoked.core, adaptersDir, hosts: createFakeHosts().hosts, log: fakeRevoked.core.log })
  equal('a revoked receipt restores rejoin-required', runtimeRevoked.bindings().map((binding) => binding.status), ['rejoin-required'])
  check('the revocation is named in the audit', fakeRevoked.audit.some((record) => record.code === 'rejoin-required' && String(record.detail).includes('revoked')), JSON.stringify(fakeRevoked.audit.filter((record) => record.code === 'rejoin-required')))
  runtimeRevoked.stop()

  const legacyDataDir = join(root, 'data-legacy')
  mkdirSync(legacyDataDir, { recursive: true })
  writeFileSync(join(legacyDataDir, 'adapters.json'), JSON.stringify({
    version: 1,
    bindings: [{ adapterId: 'ofm', caps: ['models.provide'], baseUrl: 'http://127.0.0.1:' + stub.port, boundAt: new Date().toISOString(), consentGrantedAt: new Date().toISOString() }],
  }))
  const fakeLegacy = createFakeCore(legacyDataDir, () => 'granted')
  const runtimeLegacy = await createAdapterRuntime({ core: fakeLegacy.core, adaptersDir, hosts: createFakeHosts().hosts, log: fakeLegacy.core.log })
  equal('a version 1 receipt restores rejoin-required', runtimeLegacy.bindings().map((binding) => binding.status), ['rejoin-required'])
  check('the legacy receipt is named in the audit', fakeLegacy.audit.some((record) => record.code === 'rejoin-required' && String(record.detail).includes('version 1')), JSON.stringify(fakeLegacy.audit.filter((record) => record.code === 'rejoin-required')))
  runtimeLegacy.stop()

  // ---- 7. bindModels unregisters on disconnect -------------------------------------------
  await runtime.disconnect('ofm')
  check('disconnect unregistered the model provider from the llm host', !hostsWorld.adapters.has('our-free-model'))
  excludes('disconnect removed the ofm persisted row', readFileSync(statePath, 'utf8'), '"ofm"')
  await runtime.connect('ofm')
  check('reconnecting re-registered the model provider', hostsWorld.adapters.has('our-free-model'))

  // ---- 8. unavailable after three failed health checks ------------------------------------
  await closeStub()
  for (let round = 0; round < 3; round += 1) await runtime.healthCheckOnce()
  equal('bindings become unavailable after three failed health checks', runtime.bindings().map((binding) => binding.status), ['unavailable', 'unavailable'])
  check('unavailable disposed the model provider', !hostsWorld.adapters.has('our-free-model'))
  check('unavailable disposed the registered tool', !hostsWorld.definitions.has('echo.ping'))
  excludes('the unavailable state still carries no credential', readFileSync(statePath, 'utf8'), rotatedKey)
} catch (error) {
  failed += 1
  console.log('FAIL harness crash: ' + (error instanceof Error && error.stack !== undefined ? error.stack : String(error)))
} finally {
  try {
    if (typeof disposeModels === 'function') disposeModels()
  } catch (error) {
    console.log('cleanup: disposeModels failed: ' + String(error))
  }
  try {
    if (typeof disposeTools === 'function') disposeTools()
  } catch (error) {
    console.log('cleanup: disposeTools failed: ' + String(error))
  }
  try {
    if (runtime !== undefined) runtime.stop()
  } catch (error) {
    console.log('cleanup: runtime.stop failed: ' + String(error))
  }
  try {
    await closeStub()
  } catch (error) {
    console.log('cleanup: stub close failed: ' + String(error))
  }
  if (previousUserProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = previousUserProfile
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
  try {
    rmSync(root, { recursive: true, force: true })
  } catch (error) {
    console.log('cleanup: temp root removal failed: ' + String(error))
  }
  console.log('---')
  console.log('adapter test: ' + held + ' held, ' + failed + ' failed')
  process.exit(failed === 0 ? 0 : 1)
}
