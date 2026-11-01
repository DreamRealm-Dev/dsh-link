#!/usr/bin/env node
/**
 * dsh-link-panel self-check (producer-owned, R197-contract.md section 2 P2) — THE CROSS-VERSION
 * LOADER'S FIRST REAL CUSTOMER, WITH A FALLBACK THAT DOES NOT NEED IT.
 *
 *   node plugins/dsh-link-panel/test/compat-customer.spec.mjs
 *   node plugins/dsh-link-panel/test/compat-customer.spec.mjs --self-attack
 *
 * It measures the BUILT artifact (lib/index.js, the bytes the kernel loads), mounted FIVE times into
 * throwaway kernels that differ in two things: whether the context carries link.compat (and whether that
 * loader refuses), and whether webServer is there BEFORE the row mounts or arrives AFTER it.
 *
 * THE WORLD. Each kernel is a REAL root Context from the pinned kernel's own vendored cordis
 * (core/deepseek-harness/vendor/cordis/lib/index.js) — the same module the live kernel runs — with the
 * two services this row reads provided as ordinary plugins: webServer (one register member, the route
 * sink this spec reads) and, in the loader worlds, link carrying the compat face the loader provides
 * at plugins/dsh-link-compat/lib/index.js:1007. The row is plugged as ctx.plugin({ apply, inject })
 * with the artifact's OWN inject array, so "it never waits for the loader" is a fact about the
 * delivered bytes and not about this file. Nothing hands a service to anybody: provide and get are the
 * library's own, and ctx.get('link') is the read the row actually performs.
 *
 * WHICH FACE. In the loader worlds the fixture face answers capability('http') with the member the
 * REAL loader's handle carries — the ROLE WORD `registerRoute`, measured in a booted kernel
 * (R197-contract.md section 1: Object.keys(capability('http')) is ['registerRoute', 'renderIndex']) —
 * which delegates to the same route sink and records that it was asked, so "the loader took the route"
 * is counted AT the loader, not merely claimed by the answer. Its http row is resolved out of the world
 * AT ASK TIME, which is what makes the row's ask moment measurable (W6). The role name the row reports
 * is read AS DATA out of the loader's own built table (N1), never transcribed from the contract.
 *
 * READINGS (each independently failable; the third world exists because P2 also demands the refusing
 * loader keep its own words; W4/W5/W6 exist because the LIVE order is the one the first customer got
 * wrong — the row mounts before the web server does):
 *   W1  THE LOADER WORLD: the answer carries compat { present: true, via: 'link.compat', role:
 *       'http.registerRoute', refused: null }; the loader's capability was asked for 'http' exactly
 *       once and its registerRoute received the route exactly once; the web server sink holds EXACTLY ONE
 *       route, so the row registered once and not once per face.
 *   W2  THE NO-LOADER WORLD: the answer carries compat { present: false, via: 'ctx.server', role:
 *       null, refused: null }; the loader was never consulted; the sink holds exactly one route; the
 *       mount threw nothing and left nothing waiting (apply() returned with the route already bound).
 *   W3  A LOADER THAT REFUSES LOSES NOTHING: with a loader whose capability('http') throws, the answer
 *       carries present: true, via: 'ctx.server', role: null and refused EQUAL to the loader's own
 *       message; that same message is on the error stream (nothing is swallowed); the route still
 *       answers and the sink still holds exactly one route.
 *   A1  THE ROUTE ANSWERS IN ALL THREE WORLDS: 200, application/json, cache-control no-store, ok,
 *       readOnly: true, the row's own path, and declared/mounted byte-identical to the pure projection
 *       of the same two items.
 *   A2  THE OLD ANSWER DID NOT MOVE ONE BYTE: in every world the wire text equals the answer with
 *       compat deleted, plus ',"compat":{...}' appended, and the field order is the pre-R197 list with
 *       compat last — so every field the row answered before this round keeps its position and bytes.
 *   A3  THE FACE IS THE ONLY DIFFERENCE: with the clock masked, the answer minus compat is
 *       byte-identical across all three worlds.
 *   E1  NO LOADER IS A NAMED ABSENCE, NOT A CRASH: the artifact's own inject array names no 'link'
 *       (read from the delivered bytes) and the no-loader mount does not throw.
 *   D1  THE ROUTE'S LIFETIME IS STILL THE ROW'S: disposing the row calls the disposer the binding face
 *       returned, and the sink empties — in the loader world and in the plain one.
 *   N1  THE ROLE IS THE LOADER'S OWN WORD: dsh-link-compat's built table binds role
 *       'http.registerRoute' to member 'register' on service 'webServer' (read as bytes from
 *       plugins/dsh-link-compat/lib/index.js), and the row reports that same string.
 *   K1  THE NEW FIELD IS READABLE DATA: exactly four keys, present a boolean, via one of the two
 *       names, role that name or null, refused a string or null, and a JSON round-trip that changes
 *       nothing (a function here would be the R192 marker mistake, one layer down).
 *   W4  THE LOADER IS ASKED AND ANSWERED WHEN THE SERVER IS HERE: in a world where the row mounts
 *       BEFORE webServer and the service arrives afterwards, the answer carries compat { present: true,
 *       via: 'link.compat', role: 'http.registerRoute', refused: null }; the loader's OWN registerRoute
 *       received the route (recorded at the fixture), that route IS the one the web server sink holds,
 *       and the sink holds exactly one — so the route was bound once, through the loader, late.
 *   W5  THE COUNTER-CASE: THE FALLBACK BINDS LATE TOO. With no loader in that same order, the answer
 *       carries { present: false, via: 'ctx.server', role: null, refused: null }, nothing was asked of
 *       any loader, exactly one route reached the sink, the row printed its bound line, and the route
 *       answers 200 — a half written for the loader must not lose the world that has none.
 *   W6  NOTHING IS ASKED BEFORE THE SERVER IS THERE: in the late loader world the fixture records ZERO
 *       asks made while webServer was absent and exactly one after it arrived (`['http']`). An ask made
 *       in apply() is the defect the live client reported: the loader can only answer about a world that
 *       has not mounted, and its answer is not a refusal the loader ever made.
 *
 * --self-attack stages six one-line edits of the ARTIFACT's own bytes in .tmp/r197-p2 and demands that
 * each moves exactly the readings it declares: a loader the row ignores (W1, W3, N1, W4, W6 — an
 * unconsulted loader has no refusal to publish and no ask to count), a refusal swallowed into nothing
 * (W3, alone), a fallback that stops handing the route to the web server (W2, W3, E1, D1, W5 and, because
 * they read an answer that no longer exists in those worlds, A1, A2, A3 and K1), a field woven in before
 * compat instead of appended after it (A2, alone), THE DEFECT ITSELF — the handle asked by the table's
 * kernel member name `register` instead of the role word `registerRoute`, which is the one edit that
 * leaves the loader a stranger in its own vocabulary (W1, W4 and, because a plain face binds no
 * vocabulary, N1) — and the loader asked in apply(), before the web server is there (W6, alone: the row
 * still ends up bound through the loader once the service arrives, so the only thing that moved is WHEN
 * it was asked).
 * A mutant that moves nothing, moves more than it declared, or whose anchor is no longer in the artifact,
 * fails: an unanchorable mutant is printed NOT APPLICABLE and the run is red, never a silent green.
 *
 * WHAT THIS SPEC CANNOT JUDGE (named, never reported as a pass): whether the LIVE profile mounts
 * dsh-link-compat (that is the mount's own gate), whether the live route reports via 'link.compat' (that
 * is the live read's gate), whether the real loader resolves its http row when it is mounted BEFORE the
 * web server (this fixture resolves its row at ask time, so W4 proves the ROW's ask moment and the
 * loader's member name; the loader's own freeze of an unresolved row is the loader's gate, not this
 * one), and whether the real loader's own kernel table still resolves 'http' on this machine — this
 * spec reads the loader's role binding as bytes and mounts a face of the same contract, so a loader
 * that stopped resolving http would move N1 or the live read, not this world.
 *
 * Exit 0 every reading held (under --self-attack: pristine held AND every mutant moved exactly its
 * declared readings) | 1 a reading failed | 3 NOT MEASURED (no built artifact, or the pinned kernel's
 * cordis is not on this tree), so a red is never a machine that could not run.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE = resolve(HERE, '..')
const PROJECT = resolve(PACKAGE, '..', '..')
const ARTIFACT = join(PACKAGE, 'lib', 'index.js')
const COMPAT_ARTIFACT = join(PROJECT, 'plugins', 'dsh-link-compat', 'lib', 'index.js')
const CORDIS = join(PROJECT, 'core', 'deepseek-harness', 'vendor', 'cordis', 'lib', 'index.js')
const SCRATCH = join(PROJECT, '.tmp', 'r197-p2')
const SELF_ATTACK = process.argv.includes('--self-attack')

const notMeasured = (why) => {
  console.log('NOT MEASURED: ' + why)
  process.exit(3)
}
if (!existsSync(ARTIFACT)) notMeasured('the built artifact is missing at ' + ARTIFACT + ' (build it: node plugins/build.mjs)')
if (!existsSync(CORDIS)) notMeasured("the pinned kernel's cordis is not on this tree: " + CORDIS)

const show = (value) => {
  const text = JSON.stringify(value === undefined ? null : value)
  return text === undefined ? String(value) : text
}
const canonical = (value) => show(value)
const copy = (value) => JSON.parse(JSON.stringify(value))

/** The two items the row is mounted with. No sink is mounted, which is today's truth. */
const ITEMS = [
  { id: 'panel-route', kind: 'pane', title: 'Panel route', source: 'dsh-link-panel', order: 20 },
  { id: 'panel-status', kind: 'status', title: 'Panel status', source: 'dsh-link-panel', order: 10 },
]

/** The words the refusing loader uses. The answer must carry them VERBATIM, not a summary of them. */
const LOADER_REFUSAL = 'gate-compat-customer: the loader would not hand out its http capability'

/**
 * The field list the answer carried BEFORE R197, in the order R188's builder wrote them. compat is
 * appended after these, so a gate comparing any of them by position still reads the same bytes.
 */
const ROUTE_FIELDS = ['ok', 'at', 'path', 'readOnly', 'registry', 'declared', 'mounted', 'served']

/**
 * The declared mutants. Each anchor is a line of the ARTIFACT's own bytes; a mutation that cannot be
 * built is NOT APPLICABLE and counts as an uncovered reading, never as a pass.
 */
const MUTANTS = {
  'loader-ignored': {
    from: '    if (loader.compat !== null) {',
    to: '    if (false && loader.compat !== null) {',
    why: 'the row stops preferring the loader: both loader worlds register through the plain face, so the face they report (W1, W4) and the role they claim (N1) are wrong, W3 moves with them because a loader that is never consulted has no refusal left to publish, and W6 moves because an unconsulted loader has no ask to count',
    expect: ['W1', 'W3', 'N1', 'W4', 'W6'],
  },
  'member-name-from-table': {
    from: 'capability[PANEL_COMPAT_MEMBER]',
    to: 'capability["register"]',
    why: 'THE LIVE DEFECT: the handle is keyed by ROLE WORD (registerRoute), and asking it for the table\'s kernel member name (register) finds nothing, so a loader that is mounted, reachable and willing is refused and the route falls back — W1 and W4 lose the loader and N1 loses the role it claims',
    expect: ['W1', 'N1', 'W4'],
  },
  'asked-too-early': {
    from: '    const server = webServer();\n    if (server === null) return;',
    to: '    const server = webServer();',
    why: 'the loader is asked in apply(), before the web server is there: the row still ends up bound through the loader once the service arrives, so the face and the role are right — only the MOMENT is wrong, which is what W6 counts at the fixture',
    expect: ['W6'],
  },
  'refusal-swallowed': {
    from: '      binding.refused = attempt.refused;',
    to: '      binding.refused = null;',
    why: 'a loader that refused leaves no trace in the answer (the error stream still names it), which is exactly the silence P2 forbids',
    expect: ['W3'],
  },
  'plain-face-lost': {
    from: '      disposers.push(server.register(route));',
    to: '      disposers.push(() => {});',
    // Declared wider than its subject on purpose: this mutant removes the ROUTE ITSELF from two of the
    // three worlds, and A2/A3/K1 are read THROUGH an answer, so they cannot survive a world that has none.
    // That is a cascade of one fact (no route), not six independent opinions about it.
    why: 'the fallback stops handing the route to the web server, so the three worlds that need it lose their route: W2, W3, W5, E1 and D1 directly, and A1/A2/A3/K1 because they read the answer that route serves',
    expect: ['W2', 'W3', 'A1', 'A2', 'A3', 'D1', 'E1', 'W5', 'K1'],
  },
  'field-woven-before': {
    from: '        compat: {',
    to: '        compat0: 0,\n        compat: {',
    why: 'a field is woven in BEFORE compat instead of appended after it, which is the one thing A2 measures about the old answer',
    expect: ['A2'],
  },
}

const { Context } = await import(pathToFileURL(CORDIS).href)

/**
 * The route sink: the web server's own register, and the only place a bound route can come from.
 *
 * Both registration faces end here on purpose — the loader's http capability resolves to
 * webServer.register on this kernel (N1) — so the number of routes this sink holds is the number of
 * registrations, and one route means the row did not register twice.
 */
function routeSink() {
  const routes = []
  const server = {
    register(route) {
      routes.push(route)
      return () => {
        const at = routes.indexOf(route)
        if (at !== -1) routes.splice(at, 1)
      }
    },
  }
  return { server, routes }
}

/**
 * Wait, briefly, for a condition the row reaches on its own retry path.
 *
 * Bounded on purpose: a row that never binds has to FAIL a reading, never hang the spec.
 */
async function waitFor(condition, ms = 500) {
  const deadline = Date.now() + ms
  for (;;) {
    if (condition() === true) return true
    if (Date.now() > deadline) return condition() === true
    await new Promise((done) => setTimeout(done, 5))
  }
}

/**
 * One throwaway kernel: real cordis, the services this row reads, and the row plugged as a plugin.
 *
 * `order` is the world's ARRIVAL ORDER, and it is half the subject of this spec:
 *   'server-first'  webServer is provided BEFORE the row mounts (the shape the first round measured)
 *   'server-later'  the row mounts while the web server is still ABSENT — the LIVE client's order — and
 *                   the service arrives afterwards, so the route can only be bound on the row's own
 *                   pending-webServer path.
 */
async function mountWorld(mod, shape, order = 'server-first') {
  const root = new Context()
  const spoken = []
  const complaints = []
  const { server, routes } = routeSink()
  const asked = []
  const earlyAsks = []
  const loaderRoutes = []

  if (shape === 'loader' || shape === 'loader-refuses') {
    const refuses = shape === 'loader-refuses'
    await root.plugin({
      name: 'gate-compat-loader',
      apply(ctx) {
        ctx.provide('link', {
          compat: {
            /**
             * The handle, keyed by ROLE WORD and nothing else — the real loader's `capability('http')` is
             * `{ registerRoute, renderIndex }` (measured in a booted kernel, R197-contract.md section 1),
             * so this fixture carries `registerRoute` and no kernel member name at all.
             *
             * The http row is resolved out of the world AT ASK TIME: before the web server is here there
             * is no route member to hand out, which is what makes the ask moment measurable (W6).
             */
            capability(name) {
              asked.push(name)
              if (refuses) throw new Error(LOADER_REFUSAL)
              if (name !== 'http') throw new Error('gate-compat-customer: this fixture loader carries "http" only, and "' + name + '" was asked for')
              const here = ctx.get('webServer')
              if (here === undefined || here === null) {
                earlyAsks.push(name)
                return {}
              }
              return {
                registerRoute(route) {
                  loaderRoutes.push(route)
                  return here.register(route)
                },
              }
            },
            has(name) {
              return name === 'http'
            },
            report() {
              return { kernel: 'gate-compat-customer' }
            },
          },
        })
      },
    })
  }

  const provideServer = () => root.plugin({
    name: 'gate-compat-web-server',
    apply(ctx) {
      ctx.provide('webServer', server)
    },
  })
  if (order === 'server-first') await provideServer()

  const realLog = console.log
  const realError = console.error
  console.log = (line) => spoken.push(String(line))
  console.error = (line) => complaints.push(String(line))
  let threw = null
  let fiber = null
  try {
    fiber = await root.plugin(
      { name: 'dsh-link-panel', apply: mod.apply, inject: mod.inject },
      { entries: ITEMS, sinks: [] },
    )
    if (order === 'server-later') {
      await provideServer()
      // The service is here now: the row binds on its own retry, one turn later.
      await waitFor(() => routes.length > 0)
    }
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error)
  } finally {
    console.log = realLog
    console.error = realError
  }
  return { shape, order, spoken, complaints, routes, asked, earlyAsks, loaderRoutes, threw, fiber }
}

/** The response the row's own sendJson writes into, so the reading is the wire text itself. */
function responseSink() {
  const res = {
    statusCode: 0,
    headers: {},
    text: null,
    setHeader(name, value) {
      res.headers[name] = value
    },
    end(text) {
      res.text = String(text)
    },
  }
  return res
}

/** One answer from the route the row bound, read through the row's own handler. */
async function answerOf(world) {
  const route = world.routes[0] ?? null
  if (route === null) return { route: null, status: null, headers: {}, text: null, body: null }
  const res = responseSink()
  await route.handler({ method: 'GET', url: route.path }, res)
  let body = null
  try {
    body = JSON.parse(res.text)
  } catch (error) {
    body = null
  }
  return { route, status: res.statusCode, headers: res.headers, text: res.text, body }
}

/** The answer split into the new field and the answer that was already there, with its bytes kept. */
function splitAnswer(answer) {
  const body = answer.body
  if (body === null) return { compat: null, old: null, oldText: null, appended: false }
  const compat = body.compat
  const old = {}
  for (const key of Object.keys(body)) if (key !== 'compat') old[key] = body[key]
  const oldText = JSON.stringify(old)
  const expected = oldText.slice(0, -1) + ',"compat":' + JSON.stringify(compat) + '}'
  return { compat, old, oldText, appended: answer.text === expected }
}

/** Every reading, over one artifact. Returns the rows; never throws past this function. */
async function battery(mod) {
  const rows = []
  const check = (id, ok, detail) => {
    rows.push({ id, ok: ok === true, detail: String(detail) })
    return ok === true
  }

  const loaderWorld = await mountWorld(mod, 'loader')
  const plainWorld = await mountWorld(mod, 'plain')
  const refusingWorld = await mountWorld(mod, 'loader-refuses')
  // The same two worlds in the LIVE order: the row mounts first, the web server arrives after it.
  const lateLoaderWorld = await mountWorld(mod, 'loader', 'server-later')
  const latePlainWorld = await mountWorld(mod, 'plain', 'server-later')

  const loaderAnswer = await answerOf(loaderWorld)
  const plainAnswer = await answerOf(plainWorld)
  const refusingAnswer = await answerOf(refusingWorld)
  const lateLoaderAnswer = await answerOf(lateLoaderWorld)
  const latePlainAnswer = await answerOf(latePlainWorld)
  const loaderCompat = splitAnswer(loaderAnswer).compat
  const plainCompat = splitAnswer(plainAnswer).compat
  const refusingCompat = splitAnswer(refusingAnswer).compat
  const lateLoaderCompat = splitAnswer(lateLoaderAnswer).compat
  const latePlainCompat = splitAnswer(latePlainAnswer).compat

  // ---------------------------------------------------------------- W1: the loader world
  check('W1',
    loaderWorld.threw === null
      && canonical(loaderCompat) === canonical({ present: true, via: 'link.compat', role: 'http.registerRoute', refused: null })
      && canonical(loaderWorld.asked) === canonical(['http'])
      && loaderWorld.loaderRoutes.length === 1
      && loaderWorld.routes.length === 1,
    'compat=' + canonical(loaderCompat) + ' asked=' + canonical(loaderWorld.asked)
      + ' loader-routes=' + String(loaderWorld.loaderRoutes.length) + ' sink-routes=' + String(loaderWorld.routes.length)
      + ' mount-threw=' + show(loaderWorld.threw))

  // ---------------------------------------------------------------- W2: the no-loader world
  check('W2',
    plainWorld.threw === null
      && canonical(plainCompat) === canonical({ present: false, via: 'ctx.server', role: null, refused: null })
      && plainWorld.routes.length === 1
      && plainWorld.asked.length === 0
      && plainWorld.spoken.some((line) => line.startsWith('[dsh-link-panel] state route bound on ' + mod.PANEL_ROUTE_PATH)),
    'compat=' + canonical(plainCompat) + ' sink-routes=' + String(plainWorld.routes.length)
      + ' asked=' + canonical(plainWorld.asked) + ' mount-threw=' + show(plainWorld.threw)
      + ' bound-line=' + String(plainWorld.spoken.some((line) => line.includes('state route bound on'))))

  // ---------------------------------------------------------------- W3: the loader that refuses
  check('W3',
    refusingWorld.threw === null
      && canonical(refusingCompat) === canonical({ present: true, via: 'ctx.server', role: null, refused: LOADER_REFUSAL })
      && refusingWorld.asked.length === 1
      && refusingWorld.routes.length === 1
      && refusingWorld.complaints.some((line) => line.includes(LOADER_REFUSAL)),
    'compat=' + canonical(refusingCompat) + ' asked=' + canonical(refusingWorld.asked)
      + ' sink-routes=' + String(refusingWorld.routes.length)
      + ' named-on-the-error-stream=' + String(refusingWorld.complaints.some((line) => line.includes(LOADER_REFUSAL))))

  // ---------------------------------------------------------------- W4: the loader is asked when the server is here
  check('W4',
    lateLoaderWorld.threw === null
      && canonical(lateLoaderCompat) === canonical({ present: true, via: 'link.compat', role: 'http.registerRoute', refused: null })
      && lateLoaderWorld.loaderRoutes.length === 1
      && lateLoaderWorld.loaderRoutes[0] === lateLoaderWorld.routes[0]
      && lateLoaderWorld.routes.length === 1
      && lateLoaderAnswer.status === 200,
    'compat=' + canonical(lateLoaderCompat) + ' asked=' + canonical(lateLoaderWorld.asked)
      + ' loader-routes=' + String(lateLoaderWorld.loaderRoutes.length) + ' sink-routes=' + String(lateLoaderWorld.routes.length)
      + ' the sink holds the loader\'s own route=' + String(lateLoaderWorld.loaderRoutes[0] === lateLoaderWorld.routes[0])
      + ' status=' + show(lateLoaderAnswer.status) + ' mount-threw=' + show(lateLoaderWorld.threw))

  // ---------------------------------------------------------------- W5: the counter-case, the fallback binds late
  check('W5',
    latePlainWorld.threw === null
      && canonical(latePlainCompat) === canonical({ present: false, via: 'ctx.server', role: null, refused: null })
      && latePlainWorld.routes.length === 1
      && latePlainWorld.asked.length === 0
      && latePlainAnswer.status === 200
      && latePlainWorld.spoken.some((line) => line.startsWith('[dsh-link-panel] state route bound on ' + mod.PANEL_ROUTE_PATH)),
    'compat=' + canonical(latePlainCompat) + ' sink-routes=' + String(latePlainWorld.routes.length)
      + ' asked=' + canonical(latePlainWorld.asked) + ' status=' + show(latePlainAnswer.status)
      + ' bound-line=' + String(latePlainWorld.spoken.some((line) => line.includes('state route bound on')))
      + ' mount-threw=' + show(latePlainWorld.threw))

  // ---------------------------------------------------------------- W6: nothing is asked before the server is here
  check('W6',
    canonical(lateLoaderWorld.earlyAsks) === canonical([])
      && canonical(lateLoaderWorld.asked) === canonical(['http']),
    'asks made while webServer was absent=' + canonical(lateLoaderWorld.earlyAsks)
      + '; asks made with it here=' + canonical(lateLoaderWorld.asked))

  // ---------------------------------------------------------------- A1: the route answers in all three
  const declared = canonical(mod.projectPanel(ITEMS, { sinks: mod.PANEL_SINKS }))
  const mountedView = canonical(mod.projectPanel(ITEMS, { sinks: [] }))
  const answers = [loaderAnswer, plainAnswer, refusingAnswer]
  const answering = answers.map((answer) => answer.status === 200
    && answer.headers['content-type'] === 'application/json; charset=utf-8'
    && answer.headers['cache-control'] === 'no-store'
    && answer.body !== null && answer.body.ok === true && answer.body.readOnly === true
    && answer.body.path === mod.PANEL_ROUTE_PATH
    && canonical(answer.body.declared) === declared
    && canonical(answer.body.mounted) === mountedView
    && answer.body.registry.entries === ITEMS.length)
  check('A1',
    answering.every((one) => one === true),
    answering.map((one, at) => ['link.compat', 'ctx.server', 'ctx.server-after-refusal'][at] + '=' + String(one)).join(' ')
      + '; statuses=' + canonical(answers.map((answer) => answer.status))
      + '; declared==projection=' + String(canonical(answers[0].body === null ? null : answers[0].body.declared) === declared))

  // ---------------------------------------------------------------- A2: the old answer did not move
  const appended = answers.map((answer) => splitAnswer(answer).appended)
  const keys = answers.map((answer) => (answer.body === null ? null : Object.keys(answer.body)))
  check('A2',
    appended.every((one) => one === true)
      && keys.every((list) => canonical(list) === canonical([...ROUTE_FIELDS, 'compat'])),
    'compat is the last member and every earlier field keeps its bytes: appended=' + canonical(appended)
      + '; field order=' + canonical(keys[0] ?? null))

  // ---------------------------------------------------------------- A3: the face is the only difference
  const masked = answers.map((answer) => {
    const old = splitAnswer(answer).old
    return old === null ? null : canonical({ ...old, at: 'masked' })
  })
  check('A3',
    masked.every((one) => one !== null && one === masked[0]),
    'answers minus compat (clock masked) are byte-identical across the three worlds: '
      + String(new Set(masked).size === 1) + '; bytes=' + String(masked[0] === null ? 0 : masked[0].length))

  // ---------------------------------------------------------------- E1: no loader is an absence
  const injectNames = Array.isArray(mod.inject) ? mod.inject : []
  check('E1',
    injectNames.includes('link') === false && plainWorld.threw === null && plainWorld.routes.length === 1,
    'inject=' + canonical(injectNames) + ' (names link: ' + String(injectNames.includes('link')) + ')'
      + ' mount-threw=' + show(plainWorld.threw) + ' sink-routes=' + String(plainWorld.routes.length))

  // ---------------------------------------------------------------- D1: the route's lifetime is the row's
  const disposeOf = async (world) => {
    const before = world.routes.length
    if (world.fiber === null) return { before, after: world.routes.length, threw: 'no fiber' }
    let threw = null
    try {
      await world.fiber.ctx.fiber.dispose()
    } catch (error) {
      threw = error instanceof Error ? error.message : String(error)
    }
    return { before, after: world.routes.length, threw }
  }
  const disposedLoader = await disposeOf(loaderWorld)
  const disposedPlain = await disposeOf(plainWorld)
  check('D1',
    disposedLoader.before === 1 && disposedLoader.after === 0 && disposedLoader.threw === null
      && disposedPlain.before === 1 && disposedPlain.after === 0 && disposedPlain.threw === null,
    'loader world ' + canonical(disposedLoader) + '; plain world ' + canonical(disposedPlain))

  // ---------------------------------------------------------------- N1: the role is the loader's own word
  const compatBytes = existsSync(COMPAT_ARTIFACT) ? readFileSync(COMPAT_ARTIFACT, 'utf8') : null
  const roleRow = compatBytes === null
    ? null
    : /roles: \["http\.registerRoute", "http\.renderIndex"\][\s\S]{0,400}?service: "webServer"[\s\S]{0,200}?\{ role: "http\.registerRoute", member: "register" \}/.exec(compatBytes)
  check('N1',
    roleRow !== null && mod.PANEL_COMPAT_ROLE === 'http.registerRoute' && loaderCompat !== null
      && loaderCompat.role === mod.PANEL_COMPAT_ROLE,
    compatBytes === null
      ? 'the loader is not on this tree: ' + COMPAT_ARTIFACT
      : 'the loader table binds http.registerRoute to webServer.register: ' + String(roleRow !== null)
        + '; the row reports ' + show(loaderCompat === null ? null : loaderCompat.role)
        + '; the artifact exports ' + show(mod.PANEL_COMPAT_ROLE))

  // ---------------------------------------------------------------- K1: the field is readable data
  const faces = [loaderCompat, plainCompat, refusingCompat, lateLoaderCompat, latePlainCompat]
  check('K1',
    faces.every((face) => face !== null && canonical(Object.keys(face).sort()) === canonical(['present', 'refused', 'role', 'via']))
      && faces.every((face) => typeof face.present === 'boolean')
      && faces.every((face) => face.via === mod.PANEL_VIA_LOADER || face.via === mod.PANEL_VIA_SERVER)
      && faces.every((face) => face.role === null || face.role === mod.PANEL_COMPAT_ROLE)
      && faces.every((face) => face.refused === null || typeof face.refused === 'string')
      && faces.every((face) => canonical(copy(face)) === canonical(face))
      && mod.PANEL_VIA_LOADER === 'link.compat' && mod.PANEL_VIA_SERVER === 'ctx.server',
    'faces=' + canonical(faces) + '; the two names=' + show([mod.PANEL_VIA_LOADER, mod.PANEL_VIA_SERVER]))

  return rows
}

// ------------------------------------------------------------------ run
const panel = await import(pathToFileURL(ARTIFACT).href)
const rows = await battery(panel)
for (const row of rows) console.log('  ' + (row.ok ? 'ok  ' : 'FAIL') + '  ' + row.id + ' — ' + row.detail)
const failed = rows.filter((row) => !row.ok)
console.log('')
console.log(String(rows.length) + ' readings, ' + String(rows.length - failed.length) + ' held, ' + String(failed.length) + ' failed')

if (!SELF_ATTACK) {
  // process.exitCode rather than process.exit(): a spec that dies on the way out reports the wrong thing.
  process.exitCode = failed.length === 0 ? 0 : 1
} else {
  const bytes = readFileSync(ARTIFACT, 'utf8')
  if (!existsSync(SCRATCH)) mkdirSync(SCRATCH, { recursive: true })
  const declaredBy = {}
  for (const row of rows) declaredBy[row.id] = true
  const uncovered = []
  let wrong = 0
  let notApplicable = 0
  let instrumentMoved = false
  for (const [name, mutant] of Object.entries(MUTANTS)) {
    const hits = bytes.split(mutant.from).length - 1
    console.log('')
    if (hits !== 1) {
      notApplicable += 1
      uncovered.push(...mutant.expect)
      console.log('self-attack ' + name + ': NOT APPLICABLE — the anchor occurs ' + String(hits) + ' time(s) in '
        + ARTIFACT + ', so the mutation cannot be built: ' + show(mutant.from))
      continue
    }
    const staged = join(SCRATCH, 'panel-' + name + '.mjs')
    writeFileSync(staged, bytes.split(mutant.from).join(mutant.to))
    const attacked = await import(pathToFileURL(staged).href + '?mutant=' + name)
    const attackedRows = await battery(attacked)
    const moved = attackedRows.filter((row) => !row.ok).map((row) => row.id).sort()
    const declared = [...mutant.expect].sort()
    instrumentMoved = instrumentMoved || moved.length > 0
    const exact = canonical(moved) === canonical(declared)
    if (!exact) wrong += 1
    console.log('self-attack ' + name + ': ' + show(mutant.from.trim()) + '  ->  ' + show(mutant.to.trim()))
    console.log('  why:      ' + mutant.why)
    console.log('  moved:    ' + canonical(moved))
    console.log('  declared: ' + canonical(declared))
    console.log('  exact:    ' + String(exact))
    for (const row of attackedRows.filter((one) => !one.ok)) console.log('    ' + row.id + ': ' + row.detail)
  }
  const clean = failed.length === 0
  console.log('')
  console.log('instrument moved: ' + String(instrumentMoved) + '; pristine held: ' + String(clean)
    + '; mutants off their declared set: ' + String(wrong) + '; not applicable: ' + String(notApplicable)
    + (uncovered.length === 0 ? '' : '; readings left uncovered: ' + canonical([...new Set(uncovered)].sort())))
  try {
    rmSync(SCRATCH, { recursive: true, force: true })
  } catch (error) {
    console.log('NOT MEASURED: the scratch tree at ' + SCRATCH + ' could not be cleaned: ' + String(error && error.message))
  }
  process.exitCode = clean && instrumentMoved && wrong === 0 && notApplicable === 0 ? 0 : 1
}
