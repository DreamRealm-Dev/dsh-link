#!/usr/bin/env node
/**
 * R83: PLAN.md's round index must not lag behind docs/handoff/R*.md, and no R-number may be
 * cited in PLAN without a record to land on. R78 and R82 both recorded this drift and both
 * left it in place, so it is frozen here as a reading instead of a note.
 *
 * What "cited" means, measured rather than guessed (R83):
 *   - a mention is the token R<digits> used as a ROUND TAG: in a heading ("### P20 ... (R57)")
 *     or framed by ** or an opening paren in the body ("**R66 仪器 + R67 定案**").
 *   - a bare R<digits> in prose is NOT a mention ("第二位把 R4 改到新规则并加 R11" is about that
 *     gate's *reading* R4/R11), and a bracket-list entry is not either ("flipped=[R11]").
 *   Measuring this the naive way counted 22 early rounds as indexed that are not: PLAN reuses
 *   R<n> for gate reading ids, so a tag-less match is a false green.
 *
 * Readings:
 *   R1  the subject: 153 record files, 76 distinct rounds (0..82; no record at all for 9-13, 29, 30),
 *       dedup visible, highest round >= 82
 *   R2  the index document is whole (>= 200 lines, >= 40 P-headings, "维护约定" section present)
 *   R3  every declared heading-indexed round is still heading-indexed (a dropped tag like (R52) reddens)
 *   R4  every declared body-tagged round is still tagged (containment only: a *fix* must not redden this)
 *   R5  THE DRIFT LOCK: every round with a record at >= R52 is cited in PLAN. Exemptions do not apply here
 *   R6  the exemption table is a closed, reasoned table: 38 explicit rounds, each with a >= 24 char reason,
 *       each a real record, and it must cover every uncited round below the floor
 *   R7  the floor lock: no exempt round may be >= R52, so R5 cannot be silenced from inside the table
 *   R8  every mention resolves to a record or is a named reading-label id (R11) with its PLAN line cited
 *   R9  instrument calibration: 9 framing fixtures the classifier must verdict as declared
 *   RD  the declared reading count matches what this run produced
 *
 * Baseline honesty: when R78 and R82 were uncited this gate was red and named them; the same round's
 * PLAN edit (P41) turned R5 green, and R8 stays red only until this round's own record file lands.
 * The mutant table is therefore measured against a REFERENCE world (the shipped world plus that
 * pending R83 record), so that "this reading flipped" keeps meaning the rule and not today's doc state.
 * Exit 0 all readings held; 1 a reading failed; 3 an input is missing.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const NL = String.fromCharCode(10);
const HERE = fileURLToPath(import.meta.url);
// A mutant copy of this gate runs from .tmp: the world it reads is named by the parent, never
// derived from where the copy sits (R81 measured what deriving it does: every mutant becomes a no-op).
const PROJECT = resolve(process.env.R83_PROJECT ?? resolve(dirname(HERE), ".."));
const HANDOFF = resolve(process.env.R83_HANDOFF ?? join(PROJECT, "docs", "handoff"));
const SCRATCH = join(PROJECT, ".tmp", "r83-gate");
const argv = process.argv.slice(2);
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1]; };
const JSON_OUT = argv.includes("--json");
const flat = (list) => list.length === 0 ? "(none)" : list.join(",");
const uniq = (list) => [...new Set(list)].sort((a, b) => a - b);
const contains = (haystack, needles) => needles.every((one) => haystack.includes(one));

// ---------------------------------------------------------------------------
// the frozen contract
// ---------------------------------------------------------------------------
const EXEMPT_FLOOR = 52;
const EXEMPT_FROZEN_COUNT = 38;
const RECORD_FILES_AT_LEAST = 153;
const RECORD_ROUNDS_AT_LEAST = 76;
const HIGHEST_ROUND_AT_LEAST = 82;
const PLAN_LINES_AT_LEAST = 200;
const P_HEADINGS_AT_LEAST = 40;
// PLAN's per-round index (a P-heading carrying a round number) only starts at R52: 26 headings,
// all >= R52. Everything older was written up by topic in the P1-P15 prose and has no round tag to
// find it by. That is a real gap in reachability, not a claim that those rounds did not matter, so
// it is written down as an explicit closed table rather than quietly tolerated.
const BACKLOG_REASON = "轮次早于 PLAN 的逐轮索引约定：带轮号的 P-节标题自 R52 起才出现（R83 实测 26 条全部 >= R52），这批记档的结论按主题写进了 P1-P15 正文，正文里没有轮号可查。本表在 R83 冻结且封闭：每条都是具体轮号，新轮次不得入表（读数 R7 是锁），表的大小由 EXEMPT_FROZEN_COUNT 断言。";
const EXEMPT = [
  { round: 0, reason: BACKLOG_REASON },
  { round: 1, reason: BACKLOG_REASON },
  { round: 2, reason: BACKLOG_REASON },
  { round: 3, reason: BACKLOG_REASON },
  { round: 4, reason: BACKLOG_REASON },
  { round: 5, reason: BACKLOG_REASON },
  { round: 7, reason: BACKLOG_REASON },
  { round: 8, reason: BACKLOG_REASON },
  { round: 14, reason: BACKLOG_REASON },
  { round: 15, reason: BACKLOG_REASON },
  { round: 16, reason: BACKLOG_REASON },
  { round: 17, reason: BACKLOG_REASON },
  { round: 18, reason: BACKLOG_REASON },
  { round: 19, reason: BACKLOG_REASON },
  { round: 20, reason: BACKLOG_REASON },
  { round: 21, reason: BACKLOG_REASON },
  { round: 22, reason: BACKLOG_REASON },
  { round: 23, reason: BACKLOG_REASON },
  { round: 24, reason: BACKLOG_REASON },
  { round: 25, reason: BACKLOG_REASON },
  { round: 26, reason: BACKLOG_REASON },
  { round: 27, reason: BACKLOG_REASON },
  { round: 28, reason: BACKLOG_REASON },
  { round: 31, reason: BACKLOG_REASON },
  { round: 32, reason: BACKLOG_REASON },
  { round: 33, reason: BACKLOG_REASON },
  { round: 34, reason: BACKLOG_REASON },
  { round: 35, reason: BACKLOG_REASON },
  { round: 36, reason: BACKLOG_REASON },
  { round: 37, reason: BACKLOG_REASON },
  { round: 38, reason: BACKLOG_REASON },
  { round: 40, reason: BACKLOG_REASON },
  { round: 42, reason: BACKLOG_REASON },
  { round: 43, reason: BACKLOG_REASON },
  { round: 44, reason: BACKLOG_REASON },
  { round: 45, reason: BACKLOG_REASON },
  { round: 46, reason: BACKLOG_REASON },
  { round: 49, reason: BACKLOG_REASON },
];
// PLAN reuses "R<n>" for a gate's *reading* ids. R11 is such a reading: PLAN:163 reads
// "自攻 `flipped=[R11] == declared=[R11]`、覆盖 0 漏网；**R11 是两条真 node 子进程**" and PLAN:196
// "第二位把 R4 改到新规则并加 R11". There is no R11 record file and no R11 round.
const LABEL_MENTIONS = [
  { round: 11, reason: "PLAN 里 R11 是某个门的读数编号（自攻 flipped=[R11]），不是轮次：标题/正文用它指 collab-team-dispatch 的第 11 条读数", evidence: "**R11 是两条真 node 子进程**", line: 163 },
];
const HEADING_BASE = [52,53,55,56,57,58,59,60,61,62,63,64,67,68,69,70,71,72,73,74,75,76,77,79,80,81];
const BODY_BASE = [6,39,41,47,48,50,51,54,65,66];
const MISSING_ROUNDS = [9,10,11,12,13,29,30];
const READING_IDS = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9"];
const DECLARED = READING_IDS.length + 1;

// ---------------------------------------------------------------------------
// the world, and one pure classifier over it
// ---------------------------------------------------------------------------
// One classifier, used by the world and by the calibration fixtures alike: a fixture that exercised a
// second copy of the rule would only ever prove the copy.
const mentionRounds = (line) => {
  const found = [];
  const isHeading = /^#{1,4}\s/.test(line);
  for (const match of line.matchAll(/(^|[^0-9])R(\d+)(?![-.][A-Za-z0-9])(?![0-9])/g)) {
    const at = (match.index ?? 0) + match[1].length;
    const before = line.slice(Math.max(0, at - 4), at);
    if (/=\[$/.test(before)) continue;                                              // bracketed reading list
    if (isHeading === false && /(\*\*|（|\()\s*$/.test(before) === false) continue;  // needs a round tag
    found.push(Number(match[2]));
  }
  return found;
};

const readWorld = (world) => {
  const planPath = world.plan;
  const planText = readFileSync(planPath, "utf8");
  const lines = planText.split(/\r?\n/);
  const files = readdirSync(world.records).filter((name) => name.endsWith(".md"));
  const recordFiles = files.filter((name) => /^R\d/.test(name));
  const rounds = uniq(recordFiles.map((name) => Number(name.match(/^R(\d+)/)[1])));
  const heading = [];
  const tagged = [];
  const mentionAt = {};
  lines.forEach((line, index) => {
    const isHeading = /^#{1,4}\s/.test(line);
    for (const round of mentionRounds(line)) {
      const into = isHeading ? heading : tagged;
      if (into.includes(round) === false) into.push(round);
      if (mentionAt[round] === undefined) mentionAt[round] = index + 1;
    }
  });
  const headingRounds = uniq(heading);
  const taggedRounds = uniq(tagged);
  const mentions = uniq([...headingRounds, ...taggedRounds]);
  const gaps = [];
  for (let n = 0; n <= Math.max(...rounds); n += 1) if (rounds.includes(n) === false) gaps.push(n);
  return {
    planText, lines, recordFiles, rounds, gaps, headingRounds, taggedRounds, mentions, mentionAt,
    pHeadings: lines.filter((line) => /^#{1,4}\s+P\d+/.test(line)).length,
    uncitedRecent: rounds.filter((round) => round >= EXEMPT_FLOOR && mentions.includes(round) === false),
    uncitedOld: rounds.filter((round) => round < EXEMPT_FLOOR && mentions.includes(round) === false),
    phantoms: mentions.filter((round) => rounds.includes(round) === false),
  };
};

// ---------------------------------------------------------------------------
// readings
// ---------------------------------------------------------------------------
const runReadings = (world) => {
  const readings = [];
  const held = (id, name, ok, detail) => readings.push({ id, name, ok: ok === true, detail: String(detail) });
  const here = readWorld(world);

  const dedupVisible = here.recordFiles.length > here.rounds.length;
  held("R1", "the subject: record files, distinct rounds, dedup, highest round", 
    here.recordFiles.length >= RECORD_FILES_AT_LEAST && here.rounds.length >= RECORD_ROUNDS_AT_LEAST && dedupVisible && here.rounds[0] === 0 && here.rounds.at(-1) >= HIGHEST_ROUND_AT_LEAST && contains(here.gaps, MISSING_ROUNDS),
    "files=" + String(here.recordFiles.length) + " rounds=" + String(here.rounds.length) + " first=" + String(here.rounds[0]) + " highest=" + String(here.rounds.at(-1)) + " no-record=" + flat(here.gaps.filter((n) => n <= 82)));

  held("R2", "PLAN is whole: lines, P-headings, the 维护约定 section", 
    here.lines.length >= PLAN_LINES_AT_LEAST && here.pHeadings >= P_HEADINGS_AT_LEAST && here.planText.includes("维护约定") === true,
    "lines=" + String(here.lines.length) + " P-headings=" + String(here.pHeadings) + " 维护约定=" + String(here.planText.includes("维护约定")));

  const headingMissing = HEADING_BASE.filter((round) => here.headingRounds.includes(round) === false);
  held("R3", "every declared heading-indexed round is still indexed by a heading",
    headingMissing.length === 0,
    "heading-indexed=" + String(here.headingRounds.length) + " missing=" + flat(headingMissing));

  const bodyMissing = BODY_BASE.filter((round) => here.taggedRounds.includes(round) === false);
  held("R4", "every declared body-tagged round is still tagged (containment: a fix may only add)",
    bodyMissing.length === 0,
    "tagged=" + String(here.taggedRounds.length) + " body-only=" + flat(here.taggedRounds.filter((round) => here.headingRounds.includes(round) === false)) + " missing=" + flat(bodyMissing));

  held("R5", "THE DRIFT LOCK: every record at or above R" + String(EXEMPT_FLOOR) + " is cited in PLAN",
    here.uncitedRecent.length === 0,
    here.uncitedRecent.length === 0
      ? "no lag: " + String(here.rounds.filter((round) => round >= EXEMPT_FLOOR).length) + " rounds >= R" + String(EXEMPT_FLOOR) + " all cited"
      : "PLAN has no index for " + flat(here.uncitedRecent) + " (each has a record and none is exempt)");

  const exemptBad = [];
  for (const entry of EXEMPT) {
    if (Number.isInteger(entry.round) === false) exemptBad.push("non-integer:" + String(entry.round));
    else if (typeof entry.reason !== "string" || entry.reason.trim().length < 24) exemptBad.push("thin-reason:" + String(entry.round));
    else if (here.rounds.includes(entry.round) === false) exemptBad.push("no-record:" + String(entry.round));
  }
  const unlisted = here.uncitedOld.filter((round) => EXEMPT.some((entry) => entry.round === round) === false);
  held("R6", "the exemption table is closed, reasoned and covers the whole old backlog",
    exemptBad.length === 0 && unlisted.length === 0 && EXEMPT.length === EXEMPT_FROZEN_COUNT,
    "entries=" + String(EXEMPT.length) + "/" + String(EXEMPT_FROZEN_COUNT) + " bad=" + flat(exemptBad) + " unlisted=" + flat(unlisted));

  const overFloor = EXEMPT.filter((entry) => entry.round >= EXEMPT_FLOOR).map((entry) => entry.round);
  held("R7", "the floor lock: no exempt round may be >= R" + String(EXEMPT_FLOOR),
    overFloor.length === 0,
    "exempt=" + String(EXEMPT.length) + " above-floor=" + flat(overFloor));

  const unresolved = here.phantoms.filter((round) => LABEL_MENTIONS.some((entry) => entry.round === round) === false);
  const thinLabels = LABEL_MENTIONS.filter((entry) => entry.evidence === undefined || here.planText.includes(entry.evidence) === false).map((entry) => entry.round);
  held("R8", "every mention lands on a record or on a named reading-label id",
    unresolved.length === 0 && thinLabels.length === 0,
    "mentions=" + String(here.mentions.length) + " phantom=" + flat(here.phantoms) + " unresolved=" + flat(unresolved) + " label-evidence-missing=" + flat(thinLabels));

  const fixtures = [
    { text: "### P20 设备网（R57）", expect: true, why: "heading tag" },
    { text: "- **R66 仪器 + R67 定案（债 40 结案）**：真核里", expect: true, why: "bold body tag" },
    { text: "自攻 flipped=[R11] == declared=[R11]、覆盖 0 漏网", expect: false, why: "bracket list" },
    { text: "第二位把 R4 改到新规则并加 R11", expect: false, why: "bare prose reading id" },
    { text: "- **R998 记档（读数 3 条）**", expect: true, why: "a tag stays a tag even on a gate line" },
    { text: "见 R82-plan-index.md 与 R83 记录", expect: false, why: "file name and bare number" },
    { text: "见（R78-plan-index.md）一条", expect: false, why: "parenthesised file name is not a citation" },
    { text: "（R82-plan-index.md）**R82**：把 R79–R81 补进来", expect: true, why: "the file name in parens is not a citation, the bold tag is" },
    { text: "### P1 顶部工具栏（**入口已落地（R52）**）", expect: true, why: "parenthesised heading tag" },
  ];
  const fixtureVerdicts = fixtures.map((fixture) => {
    const seen = mentionRounds(fixture.text).length > 0;
    return { why: fixture.why, ok: seen === fixture.expect, got: seen };
  });
  const fixtureWrong = fixtureVerdicts.filter((row) => row.ok === false).map((row) => row.why);
  held("R9", "instrument calibration: 9 framing fixtures verdict as declared",
    fixtureWrong.length === 0,
    String(fixtureVerdicts.length) + " fixtures, wrong=" + flat(fixtureWrong) + " verdicts=" + fixtureVerdicts.map((row) => (row.got ? "T" : "F")).join(""));

  held("RD", "the declared reading count matches what this run produced", readings.length + 1 === DECLARED, "declared=" + String(DECLARED) + " produced=" + String(readings.length + 1));
  return readings;
};

// The world this run reads. Mutants point these at their own copies; a mutant copy of this file is
// handed the same names by its parent instead of deriving them from where the copy sits (R81).
const WORLD = { plan: resolve(process.env.R83_PLAN ?? join(HANDOFF, "PLAN.md")), records: resolve(process.env.R83_RECORDS ?? HANDOFF) };
const baselineWorld = (world) => world ?? WORLD;
const signature = (world) => {
  const rows = runReadings(baselineWorld(world));
  const out = {};
  for (const row of rows) out[row.id] = { ok: row.ok, detail: row.detail };
  return out;
};
const flippedBetween = (before, after) => Object.keys(after).filter((id) => before[id].ok !== after[id].ok).sort();
const touchedBetween = (before, after) => Object.keys(after).filter((id) => before[id].detail !== after[id].detail).sort();
const listAgrees = (got, declared) => got.length === declared.length && got.every((id, at) => id === declared[at]);
// ---------------------------------------------------------------------------
// mutants, measured against a REFERENCE world: the shipped world plus the record this round is about
// to write. A red baseline makes "this reading flipped" a different question from "this reading is
// red", and the mutant table is meant to measure the rule rather than the doc state of this minute.
// The shipped world is still reported, honestly, on its own line.
// ---------------------------------------------------------------------------
const REFERENCE_RECORD = "R83-record.md";
const MUTANTS = [
  { name: "heading-tag-dropped", target: "plan", replacements: [{ from: "**入口已落地（R52）**", to: "**入口已落地**" }], moved: ["R3", "R5"], why: "a heading loses its round tag: the round stops being findable and the lock reads it as lag" },
  { name: "records-removed-batch", target: "records", remove: ["R80-debt41-constructible.md", "R81-apply-shape-gate.md", "R82-plan-index.md"], moved: ["R1", "R8"], why: "three cited records deleted at once: the subject census shrinks and each of those rounds is now a mention with no record" },
  { name: "index-citations-removed", target: "plan", replacements: [
    { from: "（R78、R82）", to: "" },
    { from: "- **R78**：把 R71", to: "- 第一次追平：把 R71" },
    { from: "；**R82**：把 R79", to: "；第二次追平：把 R79" },
  ], moved: ["R5"], why: "the Lead's just-added index lines undone: the lock must redden naming exactly 78,82" },
  { name: "record-removed-49", target: "records", remove: "R49-responsive.md", moved: ["R6"], why: "an exempt round loses its record: the exemption then points at nothing (R1's census floors keep slack because the reference world has one more round)" },
  { name: "phantom-tag", target: "plan", append: ["- **R999 记档**：凭空引用，没有对应文件"], moved: ["R8"], why: "a mention with no record to land on must not be tolerated" },
  { name: "tagged-on-a-gate-line", target: "plan", append: ["- **R998 记档（读数 3 条）**：同上"], moved: ["R8"], why: "gate vocabulary on the line must not exempt a round tag: the label exemption is a closed id list" },
  { name: "fixture-expected-flipped", target: "gate", replacements: [{ from: "{ text: \"### P20 设备网（R57）\", expect: true, why: \"heading tag\" },", to: "{ text: \"### P20 设备网（R57）\", expect: false, why: \"heading tag\" }," }], moved: ["R9"], why: "the classifier's own calibration is a reading, not a comment" },
  { name: "exempt-above-floor", target: "gate", replacements: [{ from: "const EXEMPT = [", to: "const EXEMPT = [" + NL + "  { round: 78, reason: BACKLOG_REASON }," }], moved: ["R6", "R7"], why: "the exemption table must not be usable to silence the lock" },
  { name: "plan-truncated", target: "plan", truncate: 120, moved: ["R2", "R3", "R4", "R5", "R6", "R8"], why: "a truncated index document fails whole-ness, heading tags, body tags, the backlog coverage and the lock" },
];

// Which readings each mutant *touches* (its detail moves) as opposed to flips (its verdict changes).
// Both are declared: on a red baseline a mutant can be plainly visible in a reading's detail without
// being able to make that reading any redder, and a table that watched only verdicts would call it a
// no-op.
const TOUCHED = {
  "heading-tag-dropped": ["R3", "R5", "R8"],
  "records-removed-batch": ["R1", "R5", "R8"],
  "index-citations-removed": ["R3", "R4", "R5", "R8"],
  "record-removed-49": ["R1", "R6"],
  "phantom-tag": ["R2", "R4", "R8"],
  "tagged-on-a-gate-line": ["R2", "R4", "R8"],
  "fixture-expected-flipped": ["R9"],
  "exempt-above-floor": ["R6", "R7"],
  "plan-truncated": ["R2", "R3", "R4", "R5", "R6", "R8"],
};

// Every measured world carries the record this round will write, so the table measures the rule.
const buildWorld = (mutant) => {
  const dir = join(SCRATCH, "world-" + (mutant === null ? "reference" : mutant.name));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(HANDOFF, dir, { recursive: true });
  writeFileSync(join(dir, REFERENCE_RECORD), "# " + REFERENCE_RECORD + " (synthetic; mutants and the reference world only)" + NL, "utf8");
  const plan = join(dir, "PLAN.md");
  if (mutant === null) return { plan, records: dir };
  if (mutant.target === "plan") {
    let body = readFileSync(plan, "utf8");
    if (mutant.append !== undefined) { body = body + NL + mutant.append.join(NL) + NL; }
    else if (mutant.truncate !== undefined) { body = body.split(NL).slice(0, mutant.truncate).join(NL) + NL; }
    else {
      for (const one of mutant.replacements) {
        if (body.includes(one.from) === false) return null;
        body = body.replace(one.from, one.to);
      }
    }
    writeFileSync(plan, body, "utf8");
  } else if (mutant.target === "records") {
    for (const name of (Array.isArray(mutant.remove) ? mutant.remove : [mutant.remove])) {
      const file = join(dir, name);
      if (existsSync(file) === false) return null;
      rmSync(file);
    }
  }
  return { plan, records: dir };
};

const runGateCopy = (mutant, world) => {
  let body = readFileSync(HERE, "utf8");
  for (const one of mutant.replacements) {
    if (body.includes(one.from) === false) return null;
    body = body.replace(one.from, one.to);
  }
  const file = join(SCRATCH, "gate-" + mutant.name + ".mjs");
  writeFileSync(file, body, "utf8");
  const run = spawnSync(process.execPath, [file, "--json"], {
    cwd: PROJECT, encoding: "utf8", timeout: 240000,
    env: { ...process.env, R83_PROJECT: PROJECT, R83_PLAN: world.plan, R83_RECORDS: world.records },
  });
  const line = ((run.stdout ?? "") + (run.stderr ?? "")).split(/\r?\n/).filter((one) => one.startsWith("[")).pop();
  if (line === undefined) return null;
  const rows = JSON.parse(line);
  const out = {};
  for (const row of rows) out[row.id] = { ok: row.ok, detail: row.detail };
  return out;
};

const selfTest = () => {
  let missing = 0;
  for (const mutant of MUTANTS) {
    let here = true;
    if (mutant.target === "plan") {
      const body = readFileSync(join(HANDOFF, "PLAN.md"), "utf8");
      here = mutant.replacements === undefined ? true : mutant.replacements.every((one) => body.includes(one.from));
    } else if (mutant.target === "records") {
      here = (Array.isArray(mutant.remove) ? mutant.remove : [mutant.remove]).every((name) => existsSync(join(HANDOFF, name)));
    } else {
      const body = readFileSync(HERE, "utf8");
      here = mutant.replacements.every((one) => body.includes(one.from));
    }
    if (here === false) missing += 1;
    console.log((here ? "  ok    " : "  FAIL  ") + mutant.name + "  anchor present  |  " + mutant.why);
  }
  console.log("");
  console.log(String(MUTANTS.length - missing) + " of " + String(MUTANTS.length) + " mutant anchors present");
};

const selfAttack = () => {
  mkdirSync(SCRATCH, { recursive: true });
  const base = signature(WORLD);
  const baseFailed = Object.keys(base).filter((id) => base[id].ok !== true).sort();
  const reference = buildWorld(null);
  const ref = signature(reference);
  const refFailed = Object.keys(ref).filter((id) => ref[id].ok !== true).sort();
  console.log("shipped world: failing " + flat(baseFailed) + (baseFailed.length === 0 ? "  (green)" : "  (the honest red this gate freezes)"));
  console.log("reference world (shipped + " + REFERENCE_RECORD + "): failing " + flat(refFailed) + (refFailed.length === 0 ? "  (all readings hold)" : "  MISMATCH"));
  let mismatches = refFailed.length === 0 ? 0 : 1;
  let missing = 0;
  const covered = new Set();
  for (const mutant of MUTANTS) {
    const world = mutant.target === "gate" ? reference : buildWorld(mutant);
    if (world === null) { console.log("  FAIL  " + mutant.name + "  (anchor absent)"); missing += 1; continue; }
    const after = mutant.target === "gate" ? runGateCopy(mutant, reference) : signature(world);
    if (after === null) { console.log("  FAIL  " + mutant.name + "  (the mutant could not be built)"); missing += 1; continue; }
    const moved = flippedBetween(ref, after);
    const touched = touchedBetween(ref, after);
    for (const id of moved.concat(touched)) covered.add(id);
    const declared = [...mutant.moved].sort();
    const declaredTouched = [...(TOUCHED[mutant.name] ?? [])].sort();
    const agree = listAgrees(moved, declared) && listAgrees(touched, declaredTouched);
    const green = Object.keys(after).every((id) => after[id].ok === true);
    if (agree === false) mismatches += 1;
    console.log((agree ? "  ok    " : "  FAIL  ") + mutant.name + "  flipped=" + flat(moved) + " declared=" + flat(declared) + " touched=" + flat(touched) + " touched-declared=" + flat(declaredTouched) + " green=" + (green ? "yes" : "no") + (agree ? "" : "  MISMATCH") + "  |  " + mutant.why);
  }
  const uncovered = READING_IDS.filter((id) => covered.has(id) === false);
  const realRun = spawnSync(process.execPath, [HERE], { cwd: PROJECT, encoding: "utf8", timeout: 240000, env: { ...process.env, R83_PROJECT: PROJECT } });
  const refRun = spawnSync(process.execPath, [HERE], { cwd: PROJECT, encoding: "utf8", timeout: 240000, env: { ...process.env, R83_PROJECT: PROJECT, R83_PLAN: reference.plan, R83_RECORDS: reference.records } });
  const expectedReal = baseFailed.length === 0 ? 0 : 1;
  if (realRun.status !== expectedReal || refRun.status !== 0) mismatches += 1;
  console.log("");
  console.log("exit codes: shipped world " + String(realRun.status) + " (declared " + String(expectedReal) + "); reference world " + String(refRun.status) + " (declared 0)");
  console.log("coverage: " + String(READING_IDS.length) + " module readings, " + String(covered.size) + " moved by at least one mutant, uncovered " + flat(uncovered));
  console.log("declared-set mismatches: " + String(mismatches) + "; mutants that could not be built: " + String(missing));
  return mismatches === 0 && uncovered.length === 0 && missing === 0 ? 0 : 1;
};

if (existsSync(WORLD.plan) === false || existsSync(WORLD.records) === false) {
  console.error("the handoff index is not here: " + WORLD.plan);
  process.exit(3);
}
if (argv.includes("--self-test")) { selfTest(); process.exit(0); }
if (argv.includes("--self-attack")) { process.exit(selfAttack()); }
const rows = runReadings(WORLD);
if (JSON_OUT) {
  console.log(JSON.stringify(rows));
  process.exit(rows.filter((row) => row.ok !== true).length === 0 ? 0 : 1);
}
for (const row of rows) console.log((row.ok ? "  ok    " : "  FAIL  ") + row.id + "  " + row.name + "  |  " + row.detail);
const failed = rows.filter((row) => row.ok !== true).length;
console.log("");
console.log(String(rows.length - failed) + " of " + String(rows.length) + " readings held");
process.exit(failed === 0 ? 0 : 1);
