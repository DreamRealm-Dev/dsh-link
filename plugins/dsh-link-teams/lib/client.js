window.__ModuleLoader__.load({ id: "dsh-link-teams", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// plugins/dsh-link-teams/src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react2 = require("react");
var import_react_dom = require("react-dom");

// plugins/dsh-link-teams/src/client/teams.css
var teams_default = `/* dsh-link-teams: the agent-teams pane, as a panel rather than a dump.
 *
 * Scoped under .dsh-link-teams, mounted for this plugin's lifetime (see apply()), and using only the tokens the
 * shell already carries so it cannot look like it came from another product. The inline styles the rows shipped
 * with stay for the small things (chips, error text); the layout, the header, the metric board and the folding of
 * the observed-only teams live here.
 */
.dsh-link-teams {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px 18px;
  min-height: 100%;
  box-sizing: border-box;
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xs-13);
}

/* the header: a title row with the refresh control, then the four numbers as their own board */
.dsh-link-teams .dlt-head {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsh-link-teams .dlt-titleRow {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dsh-link-teams .dlt-title {
  flex: 1 1 auto;
  font: var(--dsw-font-sm-14);
  font-weight: 600;
  letter-spacing: .01em;
}
.dsh-link-teams .dlt-refresh {
  flex: 0 0 auto;
  padding: 4px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-12);
  cursor: pointer;
}
.dsh-link-teams .dlt-refresh:hover:not(:disabled) {
  background: var(--dsw-alias-bg-l1);
  color: var(--dsw-alias-label-primary);
}
.dsh-link-teams .dlt-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(84px, 1fr));
  gap: 8px;
}
/* BLOCK, not flex: a flex item is blockified, and innerText then puts a NEWLINE between the label and the number -
   which no /\u56E2\u961F\\s+(\\d+)/ pattern matches. As a block with inline children the metric lays out and reads as one line:
   "\u6210\u5458 41" with the label dim and the number bold. */
.dsh-link-teams .dlt-metric {
  display: block;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-l1);
  min-width: 0;
}
/* INLINE, deliberately: the teams gates read the pane's text for "\u56E2\u961F N" and innerText puts a NEWLINE between two
   block-level spans, which no /\u56E2\u961F\\s+(\\d+)/ pattern matches. Inline keeps the space the value carries and lets the
   label and the number keep different weights on one line. */
.dsh-link-teams .dlt-metricLabel {
  display: inline;
  color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xxs-12);
}
.dsh-link-teams .dlt-metricValue {
  display: inline;
  font: var(--dsw-font-sm-14);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* cards: the tree, the board, the members - each one a surface with a title that says what it holds */
.dsh-link-teams .dlt-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1, transparent);
}
.dsh-link-teams .dlt-cardTitle {
  font: var(--dsw-font-xs-13);
  font-weight: 600;
}

/* capability declarations that have no member row: always drawn (a closed <details> is not rendered, so it would be
   absent from innerText), and as quiet as a fact can be while staying readable */
.dsh-link-teams .dlt-caps {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--dsw-alias-border-l1);
}
.dsh-link-teams .dlt-capsHead {
  color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xxs-12);
}
.dsh-link-teams .dlt-capsRow {
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-12);
  overflow-wrap: anywhere;
}

/* the observed-only teams: folded by default, because 29 session ids are a fact, not a thing to read first */
.dsh-link-teams .dlt-fold {
  border-top: 1px dashed var(--dsw-alias-border-l1);
  padding-top: 6px;
}
.dsh-link-teams .dlt-foldSummary {
  cursor: pointer;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-12);
  list-style: none;
}
.dsh-link-teams .dlt-foldSummary::-webkit-details-marker { display: none; }
.dsh-link-teams .dlt-foldSummary::before {
  content: '\u25B8 ';
  color: var(--dsw-alias-label-tertiary);
}
.dsh-link-teams details[open] > .dlt-foldSummary::before { content: '\u25BE '; }
.dsh-link-teams .dlt-foldList {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
}
.dsh-link-teams .dlt-foldRow {
  padding: 3px 0;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-12);
  overflow-wrap: anywhere;
}

/* ------------------------------------------------------------------------------------------------
   R313: the agent-network board.
   Columns are teams, nodes are members. The board is a picture of the cluster; the verbatim rows below it
   are still the ledger. State colours are the pane's own tokens so a skin change reaches both.
   ------------------------------------------------------------------------------------------------ */
.dlt-net { display: flex; flex-direction: column; gap: 8px; }
.dlt-netBoard { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; align-items: flex-start; }
.dlt-netTeam {
  min-width: 190px; max-width: 260px; display: flex; flex-direction: column; gap: 4px;
  border: 1px solid var(--dsw-alias-border-l2, #3a3a3a); border-radius: 10px; padding: 8px;
  background: var(--dsw-alias-fill-l1, #1b1b1b);
}
.dlt-netTeamDeclared { border-color: var(--dsw-alias-interactive-border, #4a6fa5); }
.dlt-netTeamHead { display: flex; align-items: baseline; gap: 6px; padding-bottom: 4px; }
.dlt-netTeamId { font-weight: 600; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dlt-netTeamCount {
  font-size: 11px; padding: 0 5px; border-radius: 8px;
  background: var(--dsw-alias-fill-l2, #2a2a2a); color: var(--dsw-alias-label-secondary, #bbb);
}
.dlt-netTeamState { font-size: 10px; color: var(--dsw-alias-label-tertiary, #999); margin-left: auto; white-space: nowrap; }
.dlt-node {
  display: grid; grid-template-columns: 8px 1fr auto; grid-auto-rows: min-content; gap: 2px 6px;
  align-items: center; text-align: left; width: 100%; cursor: pointer;
  border: 1px solid transparent; border-radius: 8px; padding: 5px 6px;
  background: var(--dsw-alias-fill-l2, #232323); color: inherit; font: inherit;
}
.dlt-node:hover { border-color: var(--dsw-alias-border-l2, #3a3a3a); }
.dlt-nodeOn { border-color: var(--dsw-alias-interactive-border, #4aa3ff); background: var(--dsw-alias-interactive-bg-active, #2d3a4d); }
.dlt-nodeDot { width: 8px; height: 8px; border-radius: 50%; background: #888; grid-row: span 3; align-self: center; }
.dlt-nodeDot[data-state="active"] { background: #46c07a; }
.dlt-nodeDot[data-state="provisioning"] { background: #d9a441; }
.dlt-nodeDot[data-state="gone"], .dlt-nodeDot[data-state="left"] { background: #6b6b6b; }
.dlt-nodeDot[data-state="unknown"] { background: var(--dsw-alias-state-idle-primary, #d4d4d4); }
/* R393: "busy" is the state that actually VARIES here (all 78 members report active and every heartbeat is days old),
   so the dot lights with DSH's own success token when the member holds an open task claim; idle uses the idle token,
   and "stale" (a heartbeat older than a day) sits at idle too - a dim dot never means "broken". */
.dlt-nodeDot[data-state="busy"] { background: var(--dsw-alias-state-success, #22c55e); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-success, #22c55e) 22%, transparent); }
.dlt-nodeDot[data-state="stale"] { background: var(--dsw-alias-state-idle-primary, #d4d4d4); }
.dlt-nodeDot[data-state="active"] { background: var(--dsw-alias-state-success, #46c07a); }
.dlt-nodeName { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dlt-nodeBeat { font-size: 10px; color: var(--dsw-alias-label-tertiary, #999); white-space: nowrap; }
.dlt-nodeTask { grid-column: 2 / span 2; font-size: 11px; color: var(--dsw-alias-label-secondary, #bbb); }
.dlt-nodeCaps { grid-column: 2 / span 2; font-size: 10px; color: var(--dsw-alias-label-tertiary, #999); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dlt-nodeDetail {
  border: 1px solid var(--dsw-alias-interactive-border, #4aa3ff); border-radius: 10px; padding: 8px;
  display: flex; flex-direction: column; gap: 4px; background: var(--dsw-alias-fill-l1, #1b1b1b);
}
.dlt-nodeDetailHead { display: flex; align-items: center; gap: 8px; }
.dlt-nodeDetailName { font-weight: 600; font-size: 13px; }
.dlt-nodeDetailRow { font-size: 11px; color: var(--dsw-alias-label-secondary, #bbb); word-break: break-all; }
/* R313: the selection's trail. Any row that names the selected id wears this ring, so clicking a node shows a person
   where that node appears without changing one character of the rows themselves. */
.dlt-focus {
  outline: 1px solid var(--dsw-alias-interactive-border, #4aa3ff);
  outline-offset: 2px; border-radius: 6px;
}

/* R457: the header entry and its popover - one visual language with the official header actions: a 24px pill, a
   token-coloured border and hover, a bordered popover anchored under it. */
.dlt-headAction { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px; border-radius: 7px;
  border: 0.5px solid var(--dsw-alias-border-l2, #2a2a2a); background: var(--dsw-alias-bg-layer-2, #1b1b1c);
  color: var(--dsw-alias-label-secondary, #b8bec8); font-size: 12px; line-height: 1; cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease; }
.dlt-headAction:hover { background: var(--dsw-alias-interactive-bg-hover, #24282c); color: var(--dsw-alias-label-primary, #e5e9ef); }
.dlt-headAction[data-open="true"] { border-color: var(--dsw-alias-state-success, #3fb950); color: var(--dsw-alias-label-primary, #e5e9ef); }
.dlt-headActionCount { min-width: 16px; padding: 0 5px; border-radius: 9px; background: var(--dsw-alias-bg-layer-3, #2a2d31);
  font-size: 10px; line-height: 15px; text-align: center; }
.dlt-headPopover { position: absolute; top: 30px; right: 0; z-index: 60; width: 268px; padding: 10px 12px; border-radius: 12px;
  border: 0.5px solid var(--dsw-alias-border-l2, #2a2a2a); background: var(--dsw-alias-bg-layer-2, #1b1b1c);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55); color: var(--dsw-alias-label-primary, #e5e9ef); font-size: 12px; }
.dlt-headPopoverTitle { display: flex; justify-content: space-between; margin-bottom: 6px;
  color: var(--dsw-alias-label-tertiary, #8b929c); font-size: 11px; }
.dlt-headRow { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
.dlt-headDot { width: 7px; height: 7px; border-radius: 4px; flex: 0 0 auto; }
.dlt-headName { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dlt-headState { color: var(--dsw-alias-label-tertiary, #8b929c); font-size: 11px; }
.dlt-headFoot { margin-top: 8px; padding-top: 6px; border-top: 0.5px solid var(--dsw-alias-border-l2, #2a2a2a);
  color: var(--dsw-alias-label-tertiary, #8b929c); font-size: 11px; }
\r
/* R459: the pane header, restyled. The four counts stay as "label space count" text (the teams gate parses
   /<label>\\s+(\\d+)/ out of the pane's textContent), but they become a row of stat tiles instead of four plain lines,
   the title gets a live dot, the refresh becomes a quiet ghost button, and the map's controls read as one segmented
   bar instead of browser-default buttons. */
.dlt-head { display: flex; flex-direction: column; gap: 10px; padding: 12px 12px 4px; }
.dlt-titleRow { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.dlt-title { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; letter-spacing: 0.2px;
  color: var(--dsw-alias-label-primary, #e5e9ef); }
.dlt-title::before { content: ''; width: 6px; height: 6px; border-radius: 3px; background: var(--dsw-alias-state-success, #3fb950);
  box-shadow: 0 0 0 3px rgba(63, 185, 80, 0.16); }
.dlt-refresh { height: 24px; padding: 0 10px; border-radius: 7px; border: 0.5px solid var(--dsw-alias-border-l2, #2a2e34);
  background: transparent; color: var(--dsw-alias-label-tertiary, #8b929c); font-size: 11px; line-height: 1; cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease; }
.dlt-refresh:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, #1b1b1c); color: var(--dsw-alias-label-primary, #e5e9ef); }
.dlt-refresh:disabled { opacity: 0.55; cursor: default; }
.dlt-metrics { display: flex; gap: 6px; }
.dlt-metric { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding: 7px 9px; border-radius: 9px;
  background: var(--dsw-alias-bg-layer-2, #16181b); border: 0.5px solid var(--dsw-alias-border-l2, #262a2f); }
.dlt-metricLabel { font-size: 10px; letter-spacing: 0.3px; color: var(--dsw-alias-label-tertiary, #8b929c); }
.dlt-metricValue { font-size: 15px; font-weight: 600; line-height: 1.1; color: var(--dsw-alias-label-primary, #e5e9ef);
  font-variant-numeric: tabular-nums; }
/* the map card's own title row */
[data-mindmap-card] { padding: 10px 12px 12px; border-radius: 12px; }
[data-mindmap-card] > div:first-child { display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  margin-bottom: 8px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary, #e5e9ef); }
[data-mindmap-card] > div:first-child > span { font-weight: 400; font-size: 10.5px; color: var(--dsw-alias-label-tertiary, #8b929c); }
/* the map chrome: three quiet controls, a zoom readout, then the scope toggle pushed right */
.dsh-link-mindmap-tools { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; }
.dsh-link-mindmap-tools button { height: 22px; min-width: 22px; padding: 0 8px; border-radius: 6px;
  border: 0.5px solid var(--dsw-alias-border-l2, #2a2e34); background: var(--dsw-alias-bg-layer-2, #16181b);
  color: var(--dsw-alias-label-secondary, #b8bec8); font-size: 11px; line-height: 1; cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease; }
.dsh-link-mindmap-tools button:hover { border-color: var(--dsw-alias-border-l3, #3a4048); color: var(--dsw-alias-label-primary, #e5e9ef); }
.dsh-link-mindmap-tools span { min-width: 36px; text-align: center; font-size: 11px; color: var(--dsw-alias-label-tertiary, #8b929c);
  font-variant-numeric: tabular-nums; }
.dsh-link-mindmap-tools button[data-mindmap-toggle] { margin-left: auto; }
.dsh-link-mindmap-canvas { border-radius: 10px; border: 0.5px solid var(--dsw-alias-border-l2, #24282d);
  background: radial-gradient(120% 80% at 50% 0%, rgba(255, 255, 255, 0.035), transparent 60%), var(--dsw-alias-bg-layer-1, #101214);
  padding: 4px 2px; }
/* the legend under the controls */
.dsh-link-mindmap-legend { display: flex; align-items: center; gap: 12px; margin: 0 0 8px; font-size: 10.5px;
  color: var(--dsw-alias-label-tertiary, #8b929c); }
.dsh-link-mindmap-legend i { width: 7px; height: 7px; border-radius: 4px; display: inline-block; margin-right: 4px; vertical-align: -1px; }
\r
`;

// plugins/dsh-link-teams/src/client/locales.ts
var NS = "dsh-link-teams";
var zh = {
  "teams.title": "\u667A\u80FD\u4F53\u56E2\u961F",
  "teams.guide": "\u4E00\u7AD9\u5F0F\u770B Agent \u96C6\u7FA4\uFF1A\u56E2\u961F\u6811\uFF08\u5206\u5F62\uFF09\u3001\u4EFB\u52A1\u677F\u4E0E\u8BA4\u9886\u3001\u6210\u5458\u80FD\u529B\u4E0E\u5FC3\u8DF3\u3001\u63A7\u5236\u8D26\u672C\u4E0A\u7684\u4EA4\u6D41\u8BB0\u5F55\u3002\u53EA\u8BFB\uFF0C\u6570\u636E\u6765\u81EA\u534F\u4F5C\u603B\u7EBF\u3002",
  "teams.panel.action": "\u6253\u5F00\u667A\u80FD\u4F53\u56E2\u961F\u9762\u677F",
  "teams.refresh": "\u5237\u65B0",
  "teams.refreshing": "\u5237\u65B0\u4E2D",
  "teams.chip.members": "\u6210\u5458 {count}",
  "teams.chip.tasks": "\u4EFB\u52A1 {count}",
  "teams.chip.teams": "\u56E2\u961F {count}",
  "teams.chip.records": "\u8BB0\u5F55 {count}",
  "teams.error.title": "\u8BFB\u4E0D\u5230\u8D26\u672C",
  "teams.error.separator": "\uFF1A",
  "teams.loading": "\u8BFB\u53D6\u56E2\u961F\u8D26\u672C\u2026",
  "teams.source": "\u6570\u636E\u6765\u81EA\u534F\u4F5C\u603B\u7EBF\u7684\u63A7\u5236\u8D26\u672C\uFF08linkCollab\uFF09\uFF0C\u672C\u9762\u677F\u53EA\u8BFB\u3002",
  "teams.ledger": "\u8D26\u672C {directory}\u3000writer {writer}\u3000\u6700\u540E\u5E8F\u53F7 {seq}",
  "teams.ledger.unknown": "(\u672A\u77E5)",
  "teams.damage": "\u8D26\u672C\u6709\u635F\u574F\u884C\uFF1A{damage}",
  "teams.empty.title": "\u8D26\u672C\u4E3A\u7A7A",
  "teams.empty.text": "\u603B\u7EBF\u8BFB\u5230\u4E86\uFF0C\u4F46\u8D26\u672C\u91CC\u8FD8\u6CA1\u6709\u4EFB\u4F55\u8BB0\u5F55\uFF1A\u6CA1\u6709\u58F0\u660E\uFF0C\u4E5F\u6CA1\u6709\u4EFB\u52A1\u6216\u6210\u5458\u884C\uFF0C\u6240\u4EE5\u6811\u8FD8\u5EFA\u4E0D\u8D77\u6765\uFF0C\u4E5F\u6CA1\u6709\u6210\u5458\u80FD\u58F0\u660E\u80FD\u529B\uFF08\u672A\u58F0\u660E\u80FD\u529B\uFF09\u3002",
  "teams.net.title": "Agent \u7F51",
  "teams.net.subtitle": "{teams} \u4E2A\u56E2\u961F \xB7 {members} \u4E2A\u8282\u70B9",
  "teams.net.loose": "\u6CA1\u6709\u56E2\u961F",
  "teams.net.declared": "\u5DF2\u58F0\u660E",
  "teams.net.observed": "\u4EC5\u51FA\u73B0",
  "teams.net.hint": "\u70B9\u4E00\u4E2A\u8282\u70B9\uFF1A\u5B83\u6301\u6709\u7684\u4EFB\u52A1\u548C\u5B83\u7684\u4EA4\u6D41\u8BB0\u5F55\u4F1A\u5728\u6574\u9875\u9AD8\u4EAE\u3002",
  "teams.net.picked": "\u5DF2\u9009 {label}",
  "teams.net.team": "\u56E2\u961F",
  "teams.net.task": "\u6301\u4EFB\u52A1",
  "teams.net.noTask": "\u6CA1\u6709\u5728\u529E\u4EFB\u52A1",
  "teams.net.caps": "\u80FD\u529B",
  "teams.net.noCaps": "\u672A\u58F0\u660E\u80FD\u529B",
  "teams.net.copy": "\u590D\u5236 id",
  "teams.net.copied": "\u5DF2\u590D\u5236",
  "teams.net.copyFailed": "\u590D\u5236\u5931\u8D25\uFF1A\u8FD9\u4E2A webview \u4E0D\u7ED9\u526A\u8D34\u677F",
  "teams.net.clear": "\u53D6\u6D88\u9009\u62E9",
  "teams.net.beat": "\u5FC3\u8DF3",
  "teams.tree.title": "\u56E2\u961F\u6811\uFF08\u5206\u5F62\uFF09",
  "teams.tree.empty": "\u8D26\u672C\u91CC\u6CA1\u6709\u4EFB\u4F55\u56E2\u961F\u58F0\u660E\uFF0C\u4E5F\u6CA1\u6709\u4EFB\u52A1\u6216\u6210\u5458\u884C\u5F52\u5C5E\u5230\u56E2\u961F\uFF0C\u6240\u4EE5\u6811\u8FD8\u5EFA\u4E0D\u8D77\u6765\u3002",
  "teams.tree.subtitle": "\u58F0\u660E\u51FA\u6765\u7684\u7236\u4E0E\u5B50\uFF0C\u4EE5\u53CA\u53EA\u5728\u4EFB\u52A1/\u6210\u5458\u884C\u91CC\u51FA\u73B0\u7684\u56E2\u961F",
  "teams.tree.observedOnly": "\u4EC5\u51FA\u73B0",
  "teams.tree.otherSessions": "\u5176\u4ED6\u4F1A\u8BDD",
  "teams.tree.lead": "lead {id}",
  "teams.tree.contested": "\u6709\u4E89\u7528",
  "teams.tree.orphans": "\u5B64\u513F\u56E2\u961F\uFF08\u7236\u672A\u58F0\u660E\uFF09\uFF1A{ids}",
  "teams.tree.cycles": "\u73AF\uFF1A{cycles}",
  "teams.tree.withheld": "\u8D26\u672C\u91CC\u8FD8\u6709 {count} \u4E2A\u6D4B\u8BD5\u5939\u5177\u547D\u540D\u7684\u56E2\u961F\uFF08gate-/r18x-\uFF09\uFF0C\u4E0D\u8BA1\u5165\u672C\u4E16\u754C\u3002",
  "teams.board.title": "\u4EFB\u52A1\u677F",
  "teams.board.subtitle": "{count} \u6761\uFF08\u8FDB\u884C\u4E2D\u5728\u524D\uFF09{summary}",
  "teams.board.summary": "\u3000\u5C31\u7EEA {ready}\u3000\u88AB\u963B\u585E {blocked}{deps}",
  "teams.board.summary.deps": "\u3000\u4F9D\u8D56 {count} \u6761",
  "teams.board.empty": "\u6CA1\u6709\u4EFB\u52A1\u8BB0\u5F55\u3002",
  "teams.board.unclaimed": "\u672A\u8BA4\u9886",
  "teams.board.contested": "\u6709\u4E89\u7528",
  "teams.board.records": "{count} \u6761\u8BB0\u5F55",
  "teams.board.readiness.none": "\u6CA1\u6709\u4EFB\u52A1\u8BB0\u5F55",
  "teams.board.readiness.cycle": "\u5728\u73AF\u4E0A",
  "teams.board.readiness.deleted": "\u4F9D\u8D56\u5DF2\u5220\u9664",
  "teams.board.readiness.blocked": "\u88AB\u963B\u585E {count}",
  "teams.board.readiness.ready": "\u5C31\u7EEA",
  "teams.board.depends": "\u4F9D\u8D56 {count}\uFF1A{list}",
  "teams.board.dep.met": "{label}\uFF08{state}\uFF09",
  "teams.board.dep.unmet": "{label}\uFF08{state}\uFF0C\u672A\u6EE1\u8DB3\uFF09",
  "teams.board.cycles": "\u4F9D\u8D56\u73AF\uFF1A{cycles}",
  "teams.board.cycleEdge": "\uFF08\u95ED\u5408\u8FB9 {from} \u2192 {to}\uFF09",
  "teams.board.orphans": "\u5B64\u513F\u4F9D\u8D56\uFF08\u88AB\u4F9D\u8D56\uFF0C\u4F46\u6CA1\u6709\u4EFB\u4F55\u4EFB\u52A1\u8BB0\u5F55\uFF09\uFF1A{ids}",
  "teams.members.title": "\u6210\u5458",
  "teams.members.subtitle": "{count} \u4EBA",
  "teams.members.empty": "\u6CA1\u6709\u6210\u5458\u8BB0\u5F55\u3002",
  "teams.members.beat": "\u5FC3\u8DF3 {at}",
  "teams.time.justNow": "\u521A\u521A",
  "teams.time.minutes": "{n} \u5206\u949F\u524D",
  "teams.time.hours": "{n} \u5C0F\u65F6\u524D",
  "teams.time.days": "{n} \u5929\u524D",
  "teams.members.noBeat": "\u65E0\u5FC3\u8DF3",
  "teams.members.noCaps": "\u672A\u58F0\u660E\u80FD\u529B",
  "teams.members.malformed": "\u6709 {count} \u6761\u80FD\u529B\u58F0\u660E\u8BFB\u4E0D\u51FA\u6765",
  "teams.peers.title": "Lead \u4E4B\u95F4\u7684\u63E1\u624B",
  "teams.quarantine.title": "\u9694\u79BB {count} \u9879",
  "teams.quarantine.task": "\u4EFB\u52A1 {id}",
  "teams.stream.title": "\u4EA4\u6D41\uFF08\u63A7\u5236\u8D26\u672C\uFF0C\u6700\u65B0\u5728\u4E0A\uFF09",
  "teams.stream.subtitle": "{count} \u6761",
  "teams.stream.empty": "\u8FD8\u6CA1\u6709\u63A7\u5236\u8BB0\u5F55\u3002",
  "teams.stream.hidden": "\u53E6\u6709 {count} \u6761\u6D4B\u8BD5\u8BB0\u5F55\u6CA1\u6709\u663E\u793A\uFF08\u81EA\u52A8\u9A8C\u6536\u5199\u8FDB\u8D26\u672C\u7684\uFF0C\u4E0D\u662F\u4EBA\u53D1\u7684\u6D88\u606F\uFF09\u3002",
  "teams.stream.unnamed": "\u672A\u547D\u540D\u6210\u5458",
  "teams.fixture": "\u5939\u5177",
  "teams.fixtureFold": "\u6D4B\u8BD5\u5199\u8FDB\u53BB\u7684\u884C \xB7 {count}\uFF08\u95E8/\u5939\u5177\u7559\u4E0B\u7684\uFF0C\u4E0D\u7B97\u8FDB\u4E0A\u9762\u7684\u4E16\u754C\uFF09",
  "teams.declaredOnlyFold": "\u53EA\u6709\u80FD\u529B\u58F0\u660E\u3001\u6CA1\u6709\u6210\u5458\u884C \xB7 {count}",
  "teams.fixtures.note": "\u8D26\u672C\u89C6\u56FE\u91CC\u8FD8\u6709 {tasks} \u6761\u4EFB\u52A1\u3001{members} \u4E2A\u6210\u5458\u3001{records} \u6761\u8BB0\u5F55\u5E26\u5939\u5177\u547D\u540D\uFF1A\u5B83\u4EEC\u662F\u8D26\u672C\u7684\u4E8B\u5B9E\uFF0C\u88AB\u6807\u51FA\u6765\uFF0C\u4F46\u4E0D\u7B97\u8FDB\u4E0A\u9762\u7684\u4E16\u754C\u3002",
  "teams.footer": "\u8981\u6307\u6325\u56E2\u961F\uFF1A\u5728\u804A\u5929\u6846\u91CC\u76F4\u63A5\u5BF9 lead \u8BF4\u2014\u2014\u672C\u9762\u677F\u53EA\u8BFB\uFF0C\u4E0D\u4EE3\u66FF\u5BF9\u8BDD\u3002{seen}",
  "teams.footer.seen": "\u3000\u4E0A\u6B21\u8BFB\u53D6 {time}",
  "teams.state.pending": "\u5F85\u9886",
  "teams.state.in_progress": "\u8FDB\u884C\u4E2D",
  "teams.state.completed": "\u5DF2\u5B8C\u6210",
  "teams.state.deleted": "\u5DF2\u5220\u9664",
  "teams.state.provisioning": "\u88C5\u914D\u4E2D",
  "teams.state.active": "\u5728\u7EBF",
  "teams.state.failed": "\u5931\u8D25",
  "teams.kind.task": "\u4EFB\u52A1",
  "teams.kind.member": "\u6210\u5458",
  "teams.kind.capability": "\u80FD\u529B",
  "teams.kind.team": "\u56E2\u961F",
  "teams.kind.heartbeat": "\u5FC3\u8DF3",
  "teams.kind.peer": "\u63E1\u624B",
  "teams.kind.message": "\u6D88\u606F",
  "teams.kind.session": "\u4F1A\u8BDD"
};
var en = {
  "teams.title": "Agent teams",
  "teams.guide": "One place for the agent cluster: the team tree, the task board and its claims, member capabilities and heartbeats, and the messages on the control ledger. Read-only; the data comes from the collaboration bus.",
  "teams.panel.action": "Open the agent team panel",
  "teams.refresh": "Refresh",
  "teams.refreshing": "Refreshing",
  "teams.chip.members": "Members {count}",
  "teams.chip.tasks": "Tasks {count}",
  "teams.chip.teams": "Teams {count}",
  "teams.chip.records": "Records {count}",
  "teams.error.title": "The ledger could not be read",
  "teams.error.separator": ": ",
  "teams.loading": "Reading the team ledger\u2026",
  "teams.source": "The data is the collaboration bus control ledger (linkCollab); this pane is read-only.",
  "teams.ledger": "Ledger {directory}  writer {writer}  last seq {seq}",
  "teams.ledger.unknown": "(unknown)",
  "teams.damage": "The ledger holds damaged rows: {damage}",
  "teams.empty.title": "The ledger is empty",
  "teams.empty.text": "The bus answered, but the ledger holds no records yet: no declaration and no task or member row, so the tree cannot be built and no member has declared a capability (no capability declared).",
  "teams.net.title": "Agent network",
  "teams.net.subtitle": "{teams} team(s) \xB7 {members} node(s)",
  "teams.net.loose": "no team",
  "teams.net.declared": "declared",
  "teams.net.observed": "observed only",
  "teams.net.hint": "Click a node: the tasks it holds and its ledger records light up across the pane.",
  "teams.net.picked": "selected {label}",
  "teams.net.team": "team",
  "teams.net.task": "holds",
  "teams.net.noTask": "no open task",
  "teams.net.caps": "capabilities",
  "teams.net.noCaps": "no declared capability",
  "teams.net.copy": "copy id",
  "teams.net.copied": "copied",
  "teams.net.copyFailed": "copy failed: this webview grants no clipboard",
  "teams.net.clear": "clear selection",
  "teams.net.beat": "heartbeat",
  "teams.tree.title": "Team tree (fractal)",
  "teams.tree.empty": "No team declaration and no task or member row attributed to a team, so there is no tree to draw.",
  "teams.tree.subtitle": "declared parents and children, plus the teams only the task/member rows name",
  "teams.tree.observedOnly": "observed only",
  "teams.tree.otherSessions": "other sessions",
  "teams.tree.lead": "lead {id}",
  "teams.tree.contested": "contested",
  "teams.tree.orphans": "orphan teams (parent not declared): {ids}",
  "teams.tree.cycles": "cycles: {cycles}",
  "teams.tree.withheld": "{count} team(s) in the ledger carry test-fixture names (gate-/r18x-) and are not counted in this world.",
  "teams.board.title": "Task board",
  "teams.board.subtitle": "{count} row(s), in progress first{summary}",
  "teams.board.summary": "  ready {ready}  blocked {blocked}{deps}",
  "teams.board.summary.deps": "  {count} dependency edge(s)",
  "teams.board.empty": "No task records.",
  "teams.board.unclaimed": "unclaimed",
  "teams.board.contested": "contested",
  "teams.board.records": "{count} record(s)",
  "teams.board.readiness.none": "no task record",
  "teams.board.readiness.cycle": "on a cycle",
  "teams.board.readiness.deleted": "a dependency was deleted",
  "teams.board.readiness.blocked": "blocked by {count}",
  "teams.board.readiness.ready": "ready",
  "teams.board.depends": "depends on {count}: {list}",
  "teams.board.dep.met": "{label} ({state})",
  "teams.board.dep.unmet": "{label} ({state}, unmet)",
  "teams.board.cycles": "dependency cycles: {cycles}",
  "teams.board.cycleEdge": " (closing edge {from} \u2192 {to})",
  "teams.board.orphans": "orphan dependencies (depended on, but no task record): {ids}",
  "teams.members.title": "Members",
  "teams.members.subtitle": "{count} member(s)",
  "teams.members.empty": "No member records.",
  "teams.members.beat": "heartbeat {at}",
  "teams.time.justNow": "just now",
  "teams.time.minutes": "{n} min ago",
  "teams.time.hours": "{n} h ago",
  "teams.time.days": "{n} d ago",
  "teams.members.noBeat": "no heartbeat",
  "teams.members.noCaps": "no declared capability",
  "teams.members.malformed": "{count} capability declaration(s) could not be read",
  "teams.peers.title": "Handshakes between leads",
  "teams.quarantine.title": "Isolation ({count})",
  "teams.quarantine.task": "task {id}",
  "teams.stream.title": "Messages (control ledger, newest first)",
  "teams.stream.subtitle": "{count} record(s)",
  "teams.stream.empty": "No control records yet.",
  "teams.stream.hidden": "{count} test record(s) are not shown (written by the automated checks, not sent by anyone).",
  "teams.stream.unnamed": "Unnamed member",
  "teams.fixture": "fixture",
  "teams.fixtureFold": "rows written by tests \xB7 {count} (gate/harness leftovers, not counted in the world above)",
  "teams.declaredOnlyFold": "capability declarations without a member row \xB7 {count}",
  "teams.fixtures.note": "The ledger view still holds {tasks} task(s), {members} member(s) and {records} record(s) named like test fixtures: they are facts of the ledger, they are marked, and they are not counted in the world above.",
  "teams.footer": "To direct the team, tell the lead in the chat box \u2014 this pane is read-only and does not stand in for the conversation.{seen}",
  "teams.footer.seen": "  last read {time}",
  "teams.state.pending": "pending",
  "teams.state.in_progress": "in progress",
  "teams.state.completed": "completed",
  "teams.state.deleted": "deleted",
  "teams.state.provisioning": "provisioning",
  "teams.state.active": "active",
  "teams.state.failed": "failed",
  "teams.kind.task": "task",
  "teams.kind.member": "member",
  "teams.kind.capability": "capability",
  "teams.kind.team": "team",
  "teams.kind.heartbeat": "heartbeat",
  "teams.kind.peer": "handshake",
  "teams.kind.message": "message",
  "teams.kind.session": "session"
};

// plugins/dsh-link-teams/src/client/mindmap.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var ROW_STEP = 96;
var NODE_W = 168;
var NODE_H = 46;
var GAP = 18;
var PAD = 18;
var ON = "#3fb950";
var IDLE = "#d29922";
var OFF = "#5c6a7a";
function colourOf(state) {
  if (state === "active" || state === "online") return ON;
  if (state === "idle" || state === "provisioning") return IDLE;
  return OFF;
}
function currentSession() {
  try {
    const raw = globalThis.localStorage?.getItem("dsh.sessions.current");
    if (typeof raw !== "string" || raw === "") return null;
    const id = JSON.parse(raw).sessionId;
    return typeof id === "string" && id !== "" ? id : null;
  } catch (error) {
    return null;
  }
}
function fitLabel(text2, maxWidth) {
  let width = 0;
  let out = "";
  for (const char of text2) {
    const wide = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(char);
    const step = wide ? 12 : 6.6;
    if (width + step > maxWidth) return out + "\u2026";
    out += char;
    width += step;
  }
  return out;
}
function detailOf(id, childCount) {
  const short = id.replace(/^session-/, "").slice(0, 8);
  return childCount > 0 ? short + " \xB7 " + String(childCount) + " \u56E2\u961F" : short;
}
function TeamMindmap({ teams, members, onOpen, runtime }) {
  const [titles, setTitles] = (0, import_react.useState)({});
  const [zoom, setZoom] = (0, import_react.useState)(1);
  const [scope, setScope] = (0, import_react.useState)("branch");
  const doc = teams ?? {};
  const rows = Array.isArray(members) ? members : [];
  const teamRows = Array.isArray(doc.teams) ? doc.teams : [];
  const children = doc.children ?? {};
  const me = currentSession();
  const runtimeState = (id) => {
    if (runtime === null || runtime === void 0) return void 0;
    const candidates = [id];
    if (id.startsWith("session-")) candidates.push(id.slice("session-".length));
    else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(id)) candidates.push("session-" + id);
    for (const key of candidates) {
      if (Object.prototype.hasOwnProperty.call(runtime, key)) return runtime[key] === true ? "active" : "idle";
    }
    return void 0;
  };
  const layout = (0, import_react.useMemo)(() => {
    const canon = (value) => typeof value === "string" ? value.replace(/^session-/, "") : "";
    const originalOf = /* @__PURE__ */ new Map();
    const remember = (value) => {
      const canonical = canon(value);
      if (canonical !== "" && !originalOf.has(canonical)) originalOf.set(canonical, String(value));
      return canonical;
    };
    const byTeam = /* @__PURE__ */ new Map();
    const memberNameById = /* @__PURE__ */ new Map();
    for (const member of rows) {
      const id = remember(member.id);
      const name = typeof member.name === "string" ? member.name : "";
      if (id !== "" && name !== "") memberNameById.set(id, name);
    }
    for (const member of rows) {
      const team = canon(member.team);
      if (team === "") continue;
      const list = byTeam.get(team) ?? [];
      list.push(member);
      byTeam.set(team, list);
    }
    const parentOf = /* @__PURE__ */ new Map();
    const leadOf = /* @__PURE__ */ new Map();
    for (const team of teamRows) {
      const id = remember(team.id);
      if (id === "") continue;
      parentOf.set(id, canon(team.parent) || null);
      leadOf.set(id, canon(team.lead) || null);
    }
    const childrenOf = /* @__PURE__ */ new Map();
    const addEdge = (parent, kid) => {
      if (parent === "" || kid === "" || parent === kid) return;
      const list = childrenOf.get(parent) ?? [];
      if (!list.includes(kid)) list.push(kid);
      childrenOf.set(parent, list);
    };
    for (const [parent, value] of Object.entries(children)) {
      if (!Array.isArray(value)) continue;
      const parentId = canon(parent);
      for (const kid of value) addEdge(parentId, canon(kid));
    }
    for (const [id, parent] of parentOf) if (parent !== null) addEdge(parent, id);
    const meId = me === null ? null : canon(me);
    const inBranch = /* @__PURE__ */ new Set();
    if (scope === "branch" && meId !== null) {
      let cursor = parentOf.has(meId) ? meId : null;
      const guard = /* @__PURE__ */ new Set();
      while (cursor !== null && !guard.has(cursor)) {
        guard.add(cursor);
        inBranch.add(cursor);
        cursor = parentOf.get(cursor) ?? null;
      }
      const queue = [...childrenOf.get(meId) ?? []];
      const seen = new Set(inBranch);
      while (queue.length > 0) {
        const next = queue.shift();
        if (seen.has(next)) continue;
        seen.add(next);
        inBranch.add(next);
        queue.push(...childrenOf.get(next) ?? []);
      }
    }
    const visible = (id) => inBranch.size === 0 || inBranch.has(id);
    const kidsOf = (id) => (childrenOf.get(id) ?? []).filter(visible);
    const roots = [...parentOf.keys()].filter((id) => {
      if (!visible(id)) return false;
      const parent = parentOf.get(id) ?? null;
      return parent === null || !parentOf.has(parent);
    });
    let cursorX = 0;
    const nodes = [];
    const place = (id, depth) => {
      const kids = kidsOf(id);
      const placed = kids.map((kid) => place(kid, depth + 1));
      const list = byTeam.get(id) ?? [];
      const original = originalOf.get(id) ?? id;
      const title = titles[original] ?? titles[id] ?? "";
      const named = memberNameById.get(id) ?? "";
      const label = fitLabel(title !== "" ? title : named !== "" ? named : id === meId ? "\u672C\u4F1A\u8BDD" : "\u672A\u547D\u540D\u4F1A\u8BDD", NODE_W - 36);
      const x = placed.length === 0 ? cursorX : (placed[0].x + placed[placed.length - 1].x) / 2;
      if (placed.length === 0) cursorX += NODE_W + GAP;
      const state = runtimeState(original) ?? runtimeState(id) ?? (list.length === 0 ? "idle" : String(list[0].state ?? "idle"));
      const node = { key: "mm-" + id, id: original, label, depth, x, y: depth * ROW_STEP, state, self: me !== null && id === meId, parentId: parentOf.get(id) ?? null, children: kids };
      nodes.push(node);
      return node;
    };
    roots.slice(0, 40).forEach((id) => place(id, 0));
    const maxX = nodes.reduce((max, node) => Math.max(max, node.x), 0);
    const maxDepth = nodes.reduce((max, node) => Math.max(max, node.depth), 0);
    const width = Math.max(NODE_W + PAD * 2, maxX + NODE_W + PAD * 2);
    const height = Math.max(ROW_STEP, PAD * 2 + maxDepth * ROW_STEP + NODE_H);
    return { nodes, links: nodes.flatMap((node) => node.children.map((kid) => ({ from: node.key, to: "mm-" + kid }))), width, height };
  }, [teams, members, scope, me, titles, runtime]);
  (0, import_react.useEffect)(() => {
    const ids = layout.nodes.map((node) => node.id).filter((id) => !id.startsWith("team-") && id !== "");
    if (ids.length === 0) return;
    const wanted = ids.join(",");
    let live = true;
    void fetch("/api/dsh-link-teams/session-title?ids=" + encodeURIComponent(wanted), { headers: { accept: "application/json" } }).then((answer) => answer.ok ? answer.json() : null).then((body) => {
      if (!live || body === null || body.titles === void 0) return;
      setTitles((old) => {
        const next = { ...old };
        let changed = false;
        for (const [key, value] of Object.entries(body.titles)) {
          if (typeof value === "string" && next[key] !== value) {
            next[key] = value;
            changed = true;
          }
        }
        return changed ? next : old;
      });
    }).catch(() => {
    });
    return () => {
      live = false;
    };
  }, [layout]);
  const byKey = new Map(layout.nodes.map((node) => [node.key, node]));
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-link-mindmap", "data-mindmap": "", "data-mindmap-nodes": layout.nodes.length, "data-mindmap-scope": scope, "data-mindmap-self": me ?? "", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-link-mindmap-tools", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10)), children: "\u2212" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
        Math.round(zoom * 100),
        "%"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => setZoom((z) => Math.min(1.6, Math.round((z + 0.1) * 10) / 10)), children: "+" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => setZoom(1), children: "\u9002\u914D" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", "data-mindmap-toggle": "", onClick: () => setScope((current) => current === "branch" ? "all" : "branch"), children: scope === "branch" ? "\u53EA\u770B\u672C\u5206\u652F" : "\u663E\u793A\u5168\u90E8" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-link-mindmap-legend", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { style: { background: ON } }),
        "\u5728\u7EBF"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { style: { background: IDLE } }),
        "\u7A7A\u95F2"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { style: { background: OFF } }),
        "\u79BB\u7EBF"
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-link-mindmap-canvas", style: { overflow: "auto" }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { width: layout.width * zoom, height: layout.height * zoom, viewBox: "0 0 " + String(layout.width) + " " + String(layout.height), children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("defs", { children: layout.nodes.map((node) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("clipPath", { id: "mmclip-" + node.key, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: node.x + 24, y: node.y + 2, width: NODE_W - 32, height: NODE_H - 4, rx: 4 }) }, "clip-" + node.key)) }),
      layout.links.map((link) => {
        const from = byKey.get(link.from);
        const to = byKey.get(link.to);
        if (!from || !to) return null;
        const x1 = from.x + NODE_W / 2;
        const y1 = from.y + NODE_H;
        const x2 = to.x + NODE_W / 2;
        const y2 = to.y;
        const mid = (y1 + y2) / 2;
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M " + String(x1) + " " + String(y1) + " C " + String(x1) + " " + String(mid) + ", " + String(x2) + " " + String(mid) + ", " + String(x2) + " " + String(y2), fill: "none", stroke: "#2f3a46", strokeWidth: 1.4 }, link.from + "->" + link.to);
      }),
      layout.nodes.map((node) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "g",
        {
          "data-mindmap-node": node.key,
          "data-mindmap-id": node.id,
          "data-mindmap-state": node.state,
          "data-mindmap-self": node.self ? "true" : "false",
          onClick: () => {
            if (onOpen !== void 0) onOpen(node.id, node.label, node.parentId ?? void 0);
          },
          style: { cursor: "pointer" },
          title: "\u8FDB\u5165\u4F1A\u8BDD " + node.id,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "rect",
              {
                x: node.x,
                y: node.y,
                width: NODE_W,
                height: NODE_H,
                rx: 10,
                fill: node.self ? "#22303c" : "#1b1b1c",
                stroke: node.self ? ON : node.depth === 0 ? "#3a4756" : "#2a2a2a",
                strokeWidth: node.self ? 1.6 : 1
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", { cx: node.x + 14, cy: node.y + 17, r: 4, fill: colourOf(node.state) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("text", { x: node.x + 26, y: node.y + 21, fontSize: 12, fontWeight: node.depth === 0 ? 600 : 400, fill: "#e5e9ef", clipPath: "url(#mmclip-" + node.key + ")", children: node.label }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("text", { x: node.x + 14, y: node.y + 37, fontSize: 9.5, fill: "#7b8b9e", children: detailOf(node.id, node.children.length) })
          ]
        },
        node.key
      ))
    ] }) })
  ] });
}

// plugins/dsh-link-teams/src/client/view.ts
function object(value) {
  return value !== null && typeof value === "object" ? value : {};
}
function array(value) {
  return Array.isArray(value) ? value : [];
}
function text(value) {
  return typeof value === "string" && value !== "" ? value : null;
}
function shortId(value) {
  const body = value === null || value === void 0 ? "" : String(value);
  return body.length > 8 ? body.slice(0, 8) : body || "?";
}
function teamLabel(value) {
  const body = value === null || value === void 0 ? "" : String(value);
  if (body === "") return "?";
  if (body.startsWith("session-") && body.length > 16) return body.slice(0, 16);
  return body.length > 12 ? body.slice(0, 12) : body;
}
var NUL = String.fromCharCode(0);
function taskKey(team, id) {
  return String(team === null || team === void 0 ? "" : team) + NUL + String(id);
}
function teamOfKey(key) {
  const at = key.indexOf(NUL);
  return at === -1 ? "" : key.slice(0, at);
}
function idOfKey(key) {
  const at = key.indexOf(NUL);
  return at === -1 ? key : key.slice(at + 1);
}
function taskStateWord(state, t) {
  switch (state) {
    case "pending":
      return t("teams.state.pending");
    case "in_progress":
      return t("teams.state.in_progress");
    case "completed":
      return t("teams.state.completed");
    case "deleted":
      return t("teams.state.deleted");
    default:
      return state || "?";
  }
}
function memberStateWord(state, t) {
  switch (state) {
    case "provisioning":
      return t("teams.state.provisioning");
    case "active":
      return t("teams.state.active");
    case "failed":
      return t("teams.state.failed");
    default:
      return state || "?";
  }
}
function kindWord(kind, t) {
  switch (kind) {
    case "task":
      return t("teams.kind.task");
    case "member":
      return t("teams.kind.member");
    case "capability":
      return t("teams.kind.capability");
    case "team":
      return t("teams.kind.team");
    case "heartbeat":
      return t("teams.kind.heartbeat");
    case "peer":
      return t("teams.kind.peer");
    case "message":
      return t("teams.kind.message");
    case "session":
      return t("teams.kind.session");
    default:
      return kind || "?";
  }
}
function headChips(doc, t) {
  const counts = object(doc.counts);
  const ledger = object(doc.ledger);
  const count = (value) => typeof value === "number" ? value : 0;
  return [
    { key: "members", text: t("teams.chip.members", { count: count(counts.members) }) },
    { key: "tasks", text: t("teams.chip.tasks", { count: count(counts.tasks) }) },
    { key: "teams", text: t("teams.chip.teams", { count: count(counts.teams) }) },
    { key: "records", text: t("teams.chip.records", { count: count(ledger.records) }) }
  ];
}
function currentSessionId() {
  try {
    const raw = globalThis.localStorage?.getItem("dsh.sessions.current");
    if (typeof raw !== "string" || raw === "") return null;
    const parsed = JSON.parse(raw);
    const id = object(parsed).sessionId;
    return typeof id === "string" && id !== "" ? id : null;
  } catch {
    return null;
  }
}
function isForeignTeam(id, sessionId) {
  if (sessionId === null) return false;
  if (id === sessionId) return false;
  return id.startsWith("session-") && !id.startsWith(sessionId);
}
function treeEntries(teams, sessionId = null) {
  const tree = object(teams);
  const nodes = array(tree.teams).map(object).filter((node) => typeof node.id === "string" && node.id !== "");
  const children = object(tree.children);
  const byId = /* @__PURE__ */ new Map();
  for (const node of nodes) byId.set(String(node.id), node);
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const walk = (id, depth) => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = byId.get(id) ?? { id };
    out.push({
      key: "team-" + id,
      id,
      label: teamLabel(id),
      depth,
      lead: text(node.lead),
      contested: node.contested === true,
      observedOnly: node.declared !== true,
      foreign: isForeignTeam(id, sessionId)
    });
    for (const kid of array(children[id])) if (typeof kid === "string") walk(kid, depth + 1);
  };
  for (const root of array(tree.roots)) if (typeof root === "string") walk(root, 0);
  for (const node of nodes) walk(String(node.id), 0);
  return out;
}
function taskEntries(doc, t) {
  const tasks = array(doc.tasks).map(object).filter((task) => typeof task.id === "string");
  const members = array(doc.members).map(object);
  const board = object(doc.board);
  const edges = object(board.edges);
  const blockedOf = object(board.blocked);
  const deadOf = object(board.unreachable);
  const readyKeys = Array.isArray(board.ready) ? board.ready : null;
  const cycles = array(board.cycles);
  const cycleKeys = /* @__PURE__ */ new Set();
  for (const cycle of cycles) for (const one of array(object(cycle).loop)) if (typeof one === "string") cycleKeys.add(one);
  const byKey = /* @__PURE__ */ new Map();
  for (const task of tasks) byKey.set(taskKey(task.team, task.id), task);
  const boardTeams = /* @__PURE__ */ new Set();
  for (const task of tasks) if (typeof task.team === "string" && task.team !== "") boardTeams.add(task.team);
  const crossTeam = boardTeams.size > 1;
  const nameById = /* @__PURE__ */ new Map();
  for (const member of members) if (typeof member.id === "string") nameById.set(member.id, text(member.name) ?? shortId(member.id));
  const titleOf = (key) => {
    const row = byKey.get(key);
    const title = row === void 0 ? null : text(row.title) ?? text(row.subject) ?? text(row.name);
    return title ?? idOfKey(key);
  };
  const labelOf = (key) => {
    const team = teamOfKey(key);
    return crossTeam && team !== "" ? teamLabel(team) + " / " + titleOf(key) : titleOf(key);
  };
  const labelFor = (taskKeyValue, depKey) => teamOfKey(depKey) === teamOfKey(taskKeyValue) ? idOfKey(depKey) : labelOf(depKey);
  const stateOf = (key) => {
    const row = byKey.get(key);
    if (row === void 0) return t("teams.board.readiness.none");
    return taskStateWord(typeof row.status === "string" ? row.status : "", t);
  };
  const readinessOf = (key) => {
    if (cycleKeys.has(key)) return { text: t("teams.board.readiness.cycle"), on: true };
    if (array(deadOf[key]).length > 0) return { text: t("teams.board.readiness.deleted"), on: true };
    if (array(blockedOf[key]).length > 0) return { text: t("teams.board.readiness.blocked", { count: array(blockedOf[key]).length }), on: true };
    if (readyKeys !== null && readyKeys.includes(key)) return { text: t("teams.board.readiness.ready"), on: false };
    return null;
  };
  const ordered = tasks.slice().sort((left, right) => {
    const order = { in_progress: 0, pending: 1, completed: 2, deleted: 3 };
    const a = order[String(left.status)] ?? 9;
    const b = order[String(right.status)] ?? 9;
    const delta = a - b;
    return delta !== 0 ? delta : String(left.id).localeCompare(String(right.id));
  });
  return ordered.map((task) => {
    const key = taskKey(task.team, task.id);
    const deps = array(edges[key]).filter((dep) => typeof dep === "string");
    const unmet = array(blockedOf[key]);
    const status = typeof task.status === "string" ? task.status : "";
    const statusLabel = taskStateWord(status, t);
    const readiness = readinessOf(key);
    return {
      key,
      id: String(task.id),
      label: labelOf(key),
      state: status,
      status: statusLabel,
      owner: typeof task.owner === "string" && task.owner !== "" ? nameById.get(task.owner) ?? shortId(task.owner) : null,
      // R313: the raw id beside the label, so selecting an agent can light up the task row it holds (the label is
      // what a person reads; the id is what the DOM can match on).
      ownerId: typeof task.owner === "string" && task.owner !== "" ? task.owner : null,
      contested: task.contested === true,
      readiness: readiness === null ? null : readiness.text,
      readinessOn: readiness === null ? false : readiness.on,
      records: typeof task.records === "number" ? task.records : 1,
      dependency: deps.length === 0 ? null : t("teams.board.depends", {
        count: deps.length,
        list: deps.map((dep) => t(unmet.includes(dep) ? "teams.board.dep.unmet" : "teams.board.dep.met", {
          label: labelFor(key, dep),
          state: stateOf(dep)
        })).join("\u3000")
      }),
      fixture: task.fixture === true
    };
  });
}
function boardSummary(doc, t) {
  const board = object(doc.board);
  if (Object.keys(board).length === 0) return t("teams.board.summary", { ready: 0, blocked: 0, deps: "" });
  const ready = Array.isArray(board.ready) ? board.ready.length : 0;
  const blocked = Object.keys(object(board.blocked)).length;
  const edges = object(board.edges);
  const depTotal = Object.keys(edges).reduce((sum, key) => sum + array(edges[key]).length, 0);
  return t("teams.board.summary", {
    ready,
    blocked,
    deps: depTotal > 0 ? t("teams.board.summary.deps", { count: depTotal }) : ""
  });
}
function boardCycles(doc, t) {
  const cycles = array(object(doc.board).cycles);
  if (cycles.length === 0) return null;
  const tasks = array(doc.tasks).map(object);
  const boardTeams = /* @__PURE__ */ new Set();
  for (const task of tasks) if (typeof task.team === "string" && task.team !== "") boardTeams.add(task.team);
  const crossTeam = boardTeams.size > 1;
  const labelOf = (key) => {
    const body = typeof key === "string" ? key : String(key);
    const team = teamOfKey(body);
    return crossTeam && team !== "" ? teamLabel(team) + " / " + idOfKey(body) : idOfKey(body);
  };
  return t("teams.board.cycles", {
    cycles: cycles.map((cycle) => {
      const one = object(cycle);
      const loop = array(one.loop).map(labelOf);
      const edge = array(one.edge);
      return loop.join(" \u2192 ") + (edge.length === 2 ? t("teams.board.cycleEdge", { from: labelOf(edge[0]), to: labelOf(edge[1]) }) : "");
    }).join("\uFF1B")
  });
}
function boardOrphans(doc, t) {
  const orphans = array(object(doc.board).orphans);
  if (orphans.length === 0) return null;
  const tasks = array(doc.tasks).map(object);
  const boardTeams = /* @__PURE__ */ new Set();
  for (const task of tasks) if (typeof task.team === "string" && task.team !== "") boardTeams.add(task.team);
  const crossTeam = boardTeams.size > 1;
  return t("teams.board.orphans", {
    ids: orphans.map((key) => {
      const body = typeof key === "string" ? key : String(key);
      const team = teamOfKey(body);
      return crossTeam && team !== "" ? teamLabel(team) + " / " + idOfKey(body) : idOfKey(body);
    }).join("\u3001")
  });
}
function beatAgo(at, now, t) {
  const gap = Math.max(0, now - at);
  const minute = 60 * 1e3;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (gap < minute) return t("teams.time.justNow");
  if (gap < hour) return t("teams.time.minutes", { n: Math.floor(gap / minute) });
  if (gap < day) return t("teams.time.hours", { n: Math.floor(gap / hour) });
  return t("teams.time.days", { n: Math.floor(gap / day) });
}
function memberEntries(doc, t, now = 0) {
  const members = array(doc.members).map(object).filter((member) => typeof member.id === "string");
  const beats = object(object(doc.liveness).lastHeartbeat);
  const registry = object(doc.registry);
  const capsById = /* @__PURE__ */ new Map();
  for (const row of array(registry.members).map(object)) {
    const id = text(row.id);
    if (id !== null) capsById.set(id, array(row.capabilities).filter((cap) => typeof cap === "string"));
  }
  return members.map((member) => {
    const id = String(member.id);
    const state = typeof member.state === "string" ? member.state : "";
    const stateLabel = memberStateWord(state, t);
    const caps = capsById.get(id) ?? [];
    return {
      key: "member-" + id,
      id,
      label: text(member.name) ?? shortId(id),
      state: stateLabel,
      // a heartbeat is drawn as a relative word when the caller says what "now" is, and as the raw instant when it
      // does not (a caller with no clock still gets the route's own number rather than a made-up word).
      beat: beats[id] === void 0 ? t("teams.members.noBeat") : typeof beats[id] === "number" && now > 0 ? t("teams.members.beat", { at: beatAgo(Number(beats[id]), now, t) }) : t("teams.members.beat", { at: String(beats[id]) }),
      capabilities: caps.length > 0 ? caps.join(" / ") : t("teams.members.noCaps"),
      fixture: member.fixture === true
    };
  });
}
var FIXTURE_LIKE = /^(?:gate-|g\d+-witness-|r1\d\d-|r2\d\d-)/i;
var isFixtureId = (id) => typeof id === "string" && FIXTURE_LIKE.test(id);
function declaredOnlyCapabilities(doc) {
  const members = new Set(array(doc.members).map(object).map((member) => text(member.id)).filter((id) => id !== null));
  const registry = object(doc.registry);
  const out = [];
  for (const row of array(registry.members).map(object)) {
    const id = text(row.id);
    if (id === null) continue;
    void members;
    void isFixtureId;
    const capabilities = array(row.capabilities).filter((cap) => typeof cap === "string");
    if (capabilities.length === 0) continue;
    out.push({ id, capabilities });
  }
  return out.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
var GATE_AUTHOR = /(^gate[-_])|([-_]gate$)|(gate-r\d+)|(^r\d+-.*gate$)/i;
function isTestRecord(record) {
  const author = text(record.actor) ?? text(record.senderId) ?? "";
  const body = text(record.name) ?? text(record.title) ?? text(record.text) ?? "";
  if (record.fixture === true) return true;
  return GATE_AUTHOR.test(author) || /LIVEGATE/i.test(body) || /LIVEGATE/i.test(author);
}
function hiddenTestRecords(doc) {
  return array(doc.stream).map(object).filter((record) => isTestRecord(record)).length;
}
function streamEntries(doc, t) {
  const nameById = /* @__PURE__ */ new Map();
  for (const member of array(doc.members).map(object)) {
    const id = typeof member.id === "string" ? member.id : "";
    const label = text(member.name) ?? text(member.title);
    if (id !== "" && label !== null) nameById.set(id, label);
  }
  const who = (value) => {
    const id = typeof value === "string" ? value : "";
    if (id === "") return "";
    return nameById.get(id) ?? t("teams.stream.unnamed");
  };
  const stream = array(doc.stream).map(object).filter((record) => isTestRecord(record) === false).slice().reverse();
  return stream.map((record) => {
    const kind = typeof record.kind === "string" ? record.kind : "";
    const name = text(record.name) ?? text(record.title) ?? text(record.id);
    const actors = [record.actor, record.subject, record.target, record.senderId, record.id].filter((value) => typeof value === "string" && value !== "");
    const speaker = who(record.actor ?? record.senderId);
    const target = who(record.subject ?? record.target);
    const what = name ?? "";
    const label = speaker === t("teams.stream.unnamed") ? what === "" ? speaker : what : what === "" ? speaker : speaker + "\uFF1A" + what;
    return {
      key: "rec-" + String(record.seq),
      kind: kindWord(kind.split("/")[0], t),
      label,
      state: text(record.state),
      fixture: record.fixture === true,
      actors
    };
  });
}
function peerEntries(doc) {
  return array(object(doc.peers).pairs).map(object).map((pair, index) => ({
    key: "peer-" + String(index),
    label: shortId(pair.from) + " \u2192 " + shortId(pair.to),
    state: String(pair.state || "?")
  }));
}
function quarantineEntries(doc, t) {
  const rows = array(doc.quarantine).map(object);
  const members = array(doc.members).map(object);
  const nameById = /* @__PURE__ */ new Map();
  for (const member of members) if (typeof member.id === "string") nameById.set(member.id, text(member.name) ?? shortId(member.id));
  return rows.map((entry, index) => {
    const id = typeof entry.memberId === "string" ? entry.memberId : "";
    return {
      key: "q-" + String(index) + "-" + id,
      label: nameById.get(id) ?? shortId(id),
      reason: text(entry.reason),
      task: text(entry.task) === null ? null : t("teams.quarantine.task", { id: String(entry.task) })
    };
  });
}
function withheldNote(doc, t) {
  const withheld = object(doc.teams).withheld;
  return typeof withheld === "number" && withheld > 0 ? t("teams.tree.withheld", { count: withheld }) : null;
}
function fixturesNote(doc, t) {
  const fixtures = object(doc.fixtures);
  const tasks = typeof fixtures.tasks === "number" ? fixtures.tasks : 0;
  const members = typeof fixtures.members === "number" ? fixtures.members : 0;
  const records = typeof fixtures.records === "number" ? fixtures.records : 0;
  if (tasks + members + records === 0) return null;
  return t("teams.fixtures.note", { tasks, members, records });
}
function ledgerLine(doc, t) {
  const ledger = object(doc.ledger);
  return t("teams.ledger", {
    directory: text(ledger.directory) ?? t("teams.ledger.unknown"),
    writer: ledger.writer === void 0 || ledger.writer === null ? "?" : String(ledger.writer),
    seq: typeof ledger.lastSeq === "number" ? ledger.lastSeq : "?"
  });
}
function malformedNote(doc, t) {
  const malformed = object(doc.registry).malformed;
  return typeof malformed === "number" && malformed > 0 ? t("teams.members.malformed", { count: malformed }) : null;
}
function agentNetwork(doc, t, now = 0) {
  const members = array(doc.members).map(object).filter((member) => typeof member.id === "string");
  const beats = object(object(doc.liveness).lastHeartbeat);
  const registry = object(doc.registry);
  const capsById = /* @__PURE__ */ new Map();
  for (const row of array(registry.members).map(object)) {
    const id = text(row.id);
    if (id !== null) capsById.set(id, array(row.capabilities).filter((cap) => typeof cap === "string"));
  }
  const heldBy = /* @__PURE__ */ new Map();
  for (const row of array(doc.tasks).map(object)) {
    const owner = text(object(row.claim).owner) ?? text(row.owner);
    const id = text(row.id);
    const status = text(row.status);
    if (owner === null || id === null) continue;
    if (status !== "pending" && status !== "in_progress") continue;
    if (heldBy.has(owner)) continue;
    heldBy.set(owner, status + " \xB7 " + shortId(id));
  }
  const declaredTeams = new Set(
    array(object(doc.teams).teams).map(object).filter((team) => team.declared === true).map((team) => text(team.id)).filter((id) => id !== null)
  );
  const nodes = members.map((member) => {
    const id = String(member.id);
    const stateRaw = typeof member.state === "string" ? member.state : "";
    const beatAt = beats[id];
    return {
      key: "net-" + id,
      id,
      label: text(member.name) ?? shortId(id),
      state: memberStateWord(stateRaw, t),
      stateRaw,
      beat: typeof beatAt === "number" && now > 0 ? t("teams.members.beat", { at: beatAgo(Number(beatAt), now, t) }) : t("teams.members.noBeat"),
      capabilities: capsById.get(id) ?? [],
      task: heldBy.get(id) ?? null,
      fixture: member.fixture === true,
      // R393: 'busy' means "this member holds an open task right now" - measured to be the only signal that varies
      // (every member reports state=active and every heartbeat in the ledger is days old). A heartbeat older than a day
      // is drawn 'stale' rather than the member's own word, so the dot cannot claim activity the clock contradicts.
      busy: heldBy.has(id),
      dot: heldBy.has(id) ? "busy" : typeof beatAt === "number" && now > 0 && now - Number(beatAt) > 24 * 60 * 60 * 1e3 ? "stale" : stateRaw === "" ? "unknown" : stateRaw
    };
  });
  const byTeam = /* @__PURE__ */ new Map();
  const loose = [];
  for (const member of members) {
    const node = nodes.filter((candidate) => candidate.id === String(member.id))[0];
    if (node === void 0) continue;
    const team = text(member.team);
    if (team === null) {
      loose.push(node);
      continue;
    }
    const bucket = byTeam.get(team) ?? [];
    bucket.push(node);
    byTeam.set(team, bucket);
  }
  const groups = [...byTeam.entries()].map(([team, list]) => ({
    key: "netteam-" + team,
    id: team,
    label: shortId(team),
    declared: declaredTeams.has(team),
    members: list.slice().sort((a, b) => String(a.label).localeCompare(String(b.label)))
  })).sort((a, b) => a.declared === b.declared ? b.members.length - a.members.length : a.declared ? -1 : 1);
  return { groups, loose, members: nodes.length };
}

// plugins/dsh-link-teams/src/client/index.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var API_PATH = "/api/dsh-link-teams/state";
var POLL_MS = 2e3;
var RUNTIME_PATH = "/api/session/list";
var TAB_KIND = "link-teams";
var TAB_ID = "dsh-link-teams:panel";
var LINK_PANEL_SERVICE = "linkPanel";
var SIDEBAR_RIGHT_SERVICE = "sidebarRight";
var PANEL_ITEM_ID = "dsh-link-teams:open-panel";
var PANEL_ITEM_KIND = "action";
var PANEL_ITEM_SOURCE = "dsh-link-teams";
var PANEL_ITEM_ORDER = 32;
var PANEL_MARKER = "__dshLinkTeamsPanel";
var PANEL_INVOKES = 0;
var inject = ["slots", "sidebarRightTabs", "locale", "sessions"];
var TOK = {
  border: "var(--dsw-alias-border-l2, #3a3a3a)",
  ink: "var(--dsw-alias-label-primary, #ddd)",
  ink2: "var(--dsw-alias-label-secondary, #bbb)",
  ink3: "var(--dsw-alias-label-tertiary, #999)",
  fill: "var(--dsw-alias-fill-l1, #1b1b1b)",
  active: "var(--dsw-alias-interactive-bg-active, #2d3a4d)"
};
var S = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    gap: 8,
    padding: "8px 10px",
    fontSize: 12,
    color: TOK.ink,
    overflow: "auto"
  },
  head: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  chip: (active) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "1px 7px",
    borderRadius: 10,
    border: "1px solid " + TOK.border,
    background: active ? TOK.active : "transparent",
    fontSize: 11,
    color: TOK.ink2,
    whiteSpace: "nowrap"
  }),
  card: { border: "1px solid " + TOK.border, borderRadius: 8, background: TOK.fill, padding: "6px 8px" },
  cardTitle: { fontSize: 11, color: TOK.ink3, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 },
  row: { display: "flex", alignItems: "center", gap: 6, padding: "2px 0", lineHeight: 1.5 },
  grow: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  btn: {
    padding: "2px 8px",
    borderRadius: 7,
    cursor: "pointer",
    fontSize: 11,
    border: "1px solid " + TOK.border,
    background: "transparent",
    color: TOK.ink
  },
  meta: { color: TOK.ink3, fontSize: 11, lineHeight: 1.6, wordBreak: "break-all" },
  dep: { color: TOK.ink3, fontSize: 11, lineHeight: 1.6, paddingLeft: 13, wordBreak: "break-word" },
  errWide: { color: "#ff8a8a", fontSize: 11, wordBreak: "break-word" },
  err: { color: "#ff8a8a", fontSize: 11, wordBreak: "break-all" },
  dot: (color) => ({ width: 7, height: 7, borderRadius: 4, background: color, flex: "0 0 auto" })
};
var TASK_COLOR = { pending: "#c9a227", in_progress: "#3f8cff", completed: "#3fa46a", deleted: "#777" };
var MEMBER_COLOR = { provisioning: "#c9a227", active: "#3fa46a", failed: "#e05252" };
function Glyph(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.IconUsersOutlineRegular, { size: props.size, className: props.className });
}
var openSessionById = null;
function sessionIdOf(teamId) {
  if (typeof teamId !== "string" || teamId === "") return null;
  if (teamId.startsWith("session-") && teamId.length > "session-".length) return teamId;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(teamId)) return "session-" + teamId;
  return null;
}
function openTeamSession(teamId, memberName, parentId) {
  const id = sessionIdOf(teamId);
  const raw = typeof teamId === "string" ? teamId : "";
  if (id === null) return false;
  const nav = globalThis.__dshSessionNav;
  if (nav !== void 0 && nav !== null) {
    try {
      const childId = raw !== "" && !raw.startsWith("session-") ? raw : id;
      if (parentId !== void 0 && parentId !== "" && typeof nav.openTeammate === "function" && nav.openTeammate(parentId, childId)) {
        return true;
      }
      if (typeof nav.openSession === "function" && nav.openSession(id)) return true;
    } catch (error) {
    }
  }
  if (openSessionById !== null) {
    try {
      openSessionById(id);
      return true;
    } catch (error) {
    }
  }
  void (async () => {
    const viaSidebar = await openSessionThroughSidebar(id);
    if (!viaSidebar && memberName !== void 0 && memberName !== "") await openThroughOfficialPopover(memberName);
  })();
  return true;
}
async function openThroughOfficialPopover(name) {
  if (typeof document === "undefined" || name === "") return false;
  const trigger = Array.from(document.querySelectorAll("button")).find((button) => (button.textContent ?? "").includes("\u667A\u80FD\u4F53\u56E2\u961F"));
  if (trigger === void 0) return false;
  trigger.click();
  await new Promise((resolve) => setTimeout(resolve, 350));
  const clickable = (element) => element.closest('button,[role="button"],a') ?? element;
  const candidates = Array.from(document.querySelectorAll('button,[role="button"],li,div')).filter((element) => {
    const text2 = (element.textContent ?? "").trim();
    return text2 === name || text2.startsWith(name);
  });
  if (candidates.length === 0) {
    trigger.click();
    return false;
  }
  candidates.sort((a, b) => (a.textContent ?? "").length - (b.textContent ?? "").length);
  clickable(candidates[0]).click();
  await new Promise((resolve) => setTimeout(resolve, 120));
  trigger.click();
  return true;
}
async function openSessionThroughSidebar(id) {
  try {
    if (typeof document === "undefined" || typeof fetch !== "function") return false;
    const answer = await fetch("/api/dsh-link-teams/session-title?id=" + encodeURIComponent(id), { headers: { accept: "application/json" } });
    if (!answer.ok) return false;
    const body = await answer.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (title === "") return false;
    const key = title.slice(0, 24);
    const nodes = Array.from(document.querySelectorAll('button,a,[role="button"],span,div')).filter((element) => (element.textContent ?? "").trim().startsWith(key));
    if (nodes.length === 0) return false;
    nodes.sort((a, b) => (a.textContent ?? "").length - (b.textContent ?? "").length);
    const smallest = nodes[0];
    const clickable = smallest.closest('button,a,[role="button"]') ?? smallest;
    clickable.click();
    return true;
  } catch (error) {
    return false;
  }
}
function TeamsBody(props) {
  const { t } = props;
  const [data, setData] = (0, import_react2.useState)(null);
  const [error, setError] = (0, import_react2.useState)(null);
  const [busy, setBusy] = (0, import_react2.useState)(false);
  const [seenAt, setSeenAt] = (0, import_react2.useState)(null);
  const [picked, setPicked] = (0, import_react2.useState)(null);
  const [copied, setCopied] = (0, import_react2.useState)(null);
  const [runtime, setRuntime] = (0, import_react2.useState)(null);
  (0, import_react2.useEffect)(() => {
    if (typeof document === "undefined") return;
    const marked = document.querySelectorAll("[data-net-target]");
    for (const node of marked) {
      const ids = String(node.getAttribute("data-net-target") ?? "").split(" ").filter((id) => id !== "");
      node.classList.toggle("dlt-focus", picked !== null && ids.includes(picked));
    }
  }, [picked, data]);
  const refresh = (0, import_react2.useCallback)(async () => {
    setBusy(true);
    try {
      const response = await fetch(API_PATH, { method: "GET", credentials: "same-origin", cache: "no-store" });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (payload !== null && payload.ok === true) {
        setData(payload);
        setError(null);
      } else {
        const failure = payload !== null && typeof payload.error === "object" && payload.error !== null ? payload.error : null;
        const code = failure !== null && failure.code !== void 0 && failure.code !== null ? String(failure.code) : "HTTP " + response.status;
        const message = failure !== null && typeof failure.message === "string" ? failure.message : "";
        setData(null);
        setError(code + (message !== "" ? t("teams.error.separator") + message : ""));
      }
      setSeenAt(Date.now());
    } catch (e) {
      setData(null);
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }, [t]);
  (0, import_react2.useEffect)(() => {
    void refresh();
  }, [refresh]);
  (0, import_react2.useEffect)(() => {
    if (typeof setInterval !== "function") return void 0;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);
  (0, import_react2.useEffect)(() => {
    if (typeof setInterval !== "function" || typeof fetch !== "function") return void 0;
    let live = true;
    const loadRuntime = async () => {
      try {
        const response = await fetch(RUNTIME_PATH, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "client-request",
            rpcId: "dlt-runtime-" + String(Date.now()) + "-" + String(Math.random()).slice(2, 8),
            method: "session/list",
            payload: { args: { _request: {} } }
          })
        });
        if (!response.ok) return;
        const body = await response.json();
        if (!live || body.result?.ok !== true) return;
        const map = {};
        for (const item of body.result.value?.items ?? []) {
          if (typeof item.sessionId === "string" && item.sessionId !== "") map[item.sessionId] = item.running === true;
        }
        setRuntime(map);
      } catch {
      }
    };
    void loadRuntime();
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void loadRuntime();
    }, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  const head = /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dlt-head", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dlt-titleRow", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dlt-title", children: t("teams.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "dlt-refresh", disabled: busy, onClick: () => void refresh(), children: busy ? t("teams.refreshing") : t("teams.refresh") })
    ] }),
    data === null ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dlt-metrics", children: headChips(data, t).map((chip) => {
      const text2 = String(chip.text);
      const at = text2.search(/\s/);
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dlt-metric", "data-teams-chip": chip.key, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dlt-metricLabel", children: at === -1 ? text2 : text2.slice(0, at) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dlt-metricValue", children: at === -1 ? "" : " " + text2.slice(at + 1) })
      ] }, chip.key);
    }) })
  ] });
  if (data === null) {
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.root, children: [
      head,
      error !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.card, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.cardTitle, children: t("teams.error.title") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.err, children: error })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.meta, children: t("teams.loading") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.meta, children: t("teams.source") })
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.root, "data-teams-mindmap-only": "", children: [
    head,
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.card, "data-mindmap-card": "", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.cardTitle, children: [
        "\u56E2\u961F\u7ED3\u6784 \xB7 \u601D\u7EF4\u5BFC\u56FE",
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.meta, children: "\u6EDA\u8F6E\u7F29\u653E \xB7 \u70B9\u8282\u70B9\u8FDB\u5165\u4F1A\u8BDD" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(TeamMindmap, { teams: data.teams, members: data.members, onOpen: openTeamSession, runtime })
    ] })
  ] });
  const sessionId = currentSessionId();
  const tree = treeEntries(data.teams, sessionId);
  const tasks = taskEntries(data, t);
  const members = memberEntries(data, t, Date.now());
  const orphanCaps = declaredOnlyCapabilities(data);
  const peers = peerEntries(data);
  const quarantine = quarantineEntries(data, t);
  const stream = streamEntries(data, t);
  const hiddenRecords = hiddenTestRecords(data);
  const cycles = boardCycles(data, t);
  const orphans = boardOrphans(data, t);
  const withheld = withheldNote(data, t);
  const fixtures = fixturesNote(data, t);
  const malformed = malformedNote(data, t);
  const net = agentNetwork(data, t, Date.now());
  const pickedNode = net.groups.flatMap((group) => group.members).concat(net.loose).filter((node) => node.id === picked)[0] ?? null;
  const copyId = async (value) => {
    try {
      const nav = typeof navigator === "undefined" ? null : navigator;
      if (nav === null || nav.clipboard === void 0 || typeof nav.clipboard.writeText !== "function") {
        setCopied("!");
        return;
      }
      await nav.clipboard.writeText(value);
      setCopied(value);
    } catch {
      setCopied("!");
    }
  };
  const nodeButton = (node, group) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "button",
    {
      type: "button",
      className: "dlt-node" + (picked === node.id ? " dlt-nodeOn" : ""),
      "data-net-node": node.id,
      "data-net-state": node.stateRaw,
      onClick: () => {
        setPicked(node.id === picked ? null : node.id);
        setCopied(null);
      },
      title: node.id,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dlt-nodeDot", "data-state": node.dot, "data-busy": node.busy ? "true" : void 0 }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dlt-nodeName", children: node.label }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dlt-nodeBeat", children: node.beat }),
        node.task === null ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dlt-nodeTask", children: t("teams.net.task") + " " + node.task }),
        node.capabilities.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dlt-nodeCaps", children: node.capabilities.slice(0, 3).join(" \xB7 ") + (node.capabilities.length > 3 ? " +" + String(node.capabilities.length - 3) : "") }),
        group === null ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dlt-nodeTeam", hidden: true, children: group.id })
      ]
    },
    node.key
  );
  const network = net.groups.length === 0 && net.loose.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dlt-net", "data-teams-net": "", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.cardTitle, children: [
      t("teams.net.title"),
      " ",
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.meta, children: t("teams.net.subtitle", { teams: net.groups.length, members: net.members }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dlt-netBoard", children: [
      net.groups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dlt-netTeam" + (group.declared ? " dlt-netTeamDeclared" : ""), "data-net-team": group.id, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dlt-netTeamHead", title: group.id, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dlt-netTeamId", children: group.label }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dlt-netTeamCount", children: group.members.length }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dlt-netTeamState", children: group.declared ? t("teams.net.declared") : t("teams.net.observed") })
        ] }),
        group.members.map((node) => nodeButton(node, group))
      ] }, group.key)),
      net.loose.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dlt-netTeam", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dlt-netTeamHead", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dlt-netTeamId", children: t("teams.net.loose") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dlt-netTeamCount", children: net.loose.length })
        ] }),
        net.loose.map((node) => nodeButton(node, null))
      ] }, "loose-net")
    ] }),
    pickedNode === null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.meta, children: t("teams.net.hint") }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dlt-nodeDetail", "data-net-detail": pickedNode.id, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dlt-nodeDetailHead", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dlt-nodeDot", "data-state": pickedNode.dot, "data-busy": pickedNode.busy ? "true" : void 0 }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dlt-nodeDetailName", children: pickedNode.label }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.chip(false), children: pickedNode.state }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "dlt-refresh", onClick: () => setPicked(null), children: t("teams.net.clear") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dlt-nodeDetailRow", title: pickedNode.id, children: pickedNode.id }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dlt-nodeDetailRow", children: t("teams.net.beat") + " " + pickedNode.beat + "\u3000" + t("teams.net.task") + " " + (pickedNode.task === null ? t("teams.net.noTask") : pickedNode.task) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dlt-nodeDetailRow", children: t("teams.net.caps") + " " + (pickedNode.capabilities.length === 0 ? t("teams.net.noCaps") : pickedNode.capabilities.join(" / ")) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dlt-nodeDetailRow", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "dlt-refresh", onClick: () => void copyId(pickedNode.id), children: copied === pickedNode.id ? t("teams.net.copied") : t("teams.net.copy") }),
        copied === "!" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.err, children: t("teams.net.copyFailed") }) : null
      ] })
    ] })
  ] });
  const ledgerEmpty = members.length === 0 && tasks.length === 0 && stream.length === 0;
  const seen = seenAt === null ? "" : t("teams.footer.seen", { time: new Date(seenAt).toLocaleTimeString() });
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.root, className: "dsh-link-teams", children: [
    head,
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.meta, children: ledgerLine(data, t) }),
    data.ledger !== null && typeof data.ledger === "object" && data.ledger.damage ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.err, children: t("teams.damage", { damage: JSON.stringify(data.ledger.damage) }) }) : null,
    fixtures === null ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.meta, children: fixtures }),
    ledgerEmpty ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.cardTitle, children: t("teams.empty.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.meta, children: t("teams.empty.text") })
    ] }) : null,
    tree.length === 0 && withheld === null && ledgerEmpty === false ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.meta, children: t("teams.tree.empty") }) : null,
    tree.length === 0 && withheld === null ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.cardTitle, children: [
        t("teams.tree.title"),
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.meta, children: t("teams.tree.subtitle") })
      ] }),
      tree.filter((entry) => entry.observedOnly !== true && entry.foreign !== true).map((entry) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dlt-treeRow", style: { ...S.row, paddingLeft: 12 * entry.depth, cursor: "pointer" }, "data-teams-row": entry.id, onClick: () => {
        openTeamSession(entry.id);
      }, title: "\u6253\u5F00\u4F1A\u8BDD " + entry.id, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.grow, title: entry.id, children: (entry.depth > 0 ? "\u2514 " : "") + entry.label }),
        entry.lead === null ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.chip(false), children: t("teams.tree.lead", { id: entry.lead }) }),
        entry.contested ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.chip(true), children: t("teams.tree.contested") }) : null
      ] }, entry.key)),
      tree.filter((entry) => entry.foreign === true).length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { className: "dlt-fold", "data-teams-fold": "other-sessions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { className: "dlt-foldSummary", children: t("teams.tree.otherSessions") + " \xB7 " + String(tree.filter((entry) => entry.foreign === true).length) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "dlt-foldList", children: tree.filter((entry) => entry.foreign === true).map((entry) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { className: "dlt-foldRow dlt-treeRow", "data-teams-row": entry.id, style: { opacity: 0.55, cursor: "pointer" }, onClick: () => {
          openTeamSession(entry.id);
        }, title: "\u6253\u5F00\u4F1A\u8BDD " + entry.id, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { title: entry.id, children: (entry.depth > 0 ? "\u2514 " : "") + entry.label }),
          entry.lead === null ? null : " \xB7 " + t("teams.tree.lead", { id: entry.lead })
        ] }, entry.key)) })
      ] }),
      tree.filter((entry) => entry.observedOnly === true).length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { className: "dlt-fold", "data-teams-fold": "observed-only", open: void 0, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { className: "dlt-foldSummary", children: t("teams.tree.observedOnly") + " \xB7 " + String(tree.filter((entry) => entry.observedOnly === true).length) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "dlt-foldList", children: tree.filter((entry) => entry.observedOnly === true).map((entry) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("li", { className: "dlt-foldRow dlt-treeRow", "data-teams-row": entry.id, style: { cursor: "pointer" }, onClick: () => {
          openTeamSession(entry.id);
        }, title: "\u6253\u5F00\u4F1A\u8BDD " + entry.id, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { title: entry.id, children: (entry.depth > 0 ? "\u2514 " : "") + entry.label }),
          entry.lead === null ? null : " \xB7 " + t("teams.tree.lead", { id: entry.lead }),
          entry.contested ? " \xB7 " + t("teams.tree.contested") : null
        ] }, entry.key)) })
      ] }),
      data.teams !== null && typeof data.teams === "object" && Array.isArray(data.teams.orphans) && data.teams.orphans.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.err, children: t("teams.tree.orphans", { ids: data.teams.orphans.map((id) => typeof id === "string" && id.length > 12 ? id.slice(0, 12) : String(id)).join(", ") }) }) : null,
      data.teams !== null && typeof data.teams === "object" && Array.isArray(data.teams.cycles) && data.teams.cycles.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.err, children: t("teams.tree.cycles", { cycles: JSON.stringify(data.teams.cycles) }) }) : null,
      withheld === null ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.meta, children: withheld })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.card, "data-mindmap-card": "", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.cardTitle, children: [
        "\u56E2\u961F\u7ED3\u6784 \xB7 \u601D\u7EF4\u5BFC\u56FE",
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.meta, children: "\u7F29\u653E / \u9002\u914D" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(TeamMindmap, { teams: data.teams, members: data.members })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.cardTitle, children: [
        t("teams.board.title"),
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.meta, children: t("teams.board.subtitle", { count: tasks.length, summary: boardSummary(data, t) }) })
      ] }),
      tasks.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.meta, children: t("teams.board.empty") }) : tasks.filter((task) => task.fixture !== true).map((task) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { ...S.row, flexWrap: "wrap" }, "data-net-target": task.ownerId ?? "", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.dot(TASK_COLOR[task.state] ?? "#888") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.chip(false), children: task.status }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { ...S.grow, minWidth: 70 }, title: task.id, children: task.label }),
          task.owner === null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.meta, children: t("teams.board.unclaimed") }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.chip(false), children: task.owner }),
          task.contested ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.chip(true), children: t("teams.board.contested") }) : null,
          task.readiness === null ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.chip(task.readinessOn), children: task.readiness }),
          task.records > 1 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.meta, children: t("teams.board.records", { count: task.records }) }) : null,
          task.fixture ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.chip(true), children: t("teams.fixture") }) : null
        ] }),
        task.dependency === null ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.dep, children: task.dependency })
      ] }, task.key)),
      tasks.filter((task) => task.fixture === true).length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { className: "dlt-fold", "data-teams-fold": "fixture-tasks", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { className: "dlt-foldSummary", children: t("teams.fixtureFold", { count: tasks.filter((task) => task.fixture === true).length }) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "dlt-foldList", children: tasks.filter((task) => task.fixture === true).map((task) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("li", { className: "dlt-foldRow", title: task.id, children: task.status + " \xB7 " + task.label + " \xB7 " + task.state }, task.key)) })
      ] }),
      cycles === null ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.errWide, children: cycles }),
      orphans === null ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.errWide, children: orphans })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.cardTitle, children: [
        t("teams.members.title"),
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.meta, children: t("teams.members.subtitle", { count: members.length }) })
      ] }),
      members.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.meta, children: t("teams.members.empty") }) : members.filter((member) => member.fixture !== true).map((member) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { ...S.row, flexWrap: "wrap" }, "data-net-target": member.id, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.dot(MEMBER_COLOR[member.state] ?? "#888") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { ...S.grow, minWidth: 70 }, title: member.id, children: member.label }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.chip(false), children: member.state }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.chip(false), children: member.beat }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.meta, children: member.capabilities }),
        member.fixture ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.chip(true), children: t("teams.fixture") }) : null
      ] }, member.key)),
      members.filter((member) => member.fixture === true).length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { className: "dlt-fold", "data-teams-fold": "fixture-members", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { className: "dlt-foldSummary", children: t("teams.fixtureFold", { count: members.filter((member) => member.fixture === true).length }) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { className: "dlt-foldList", children: members.filter((member) => member.fixture === true).map((member) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("li", { className: "dlt-foldRow", title: member.id, children: member.label + " \xB7 " + member.state + " \xB7 " + member.beat + " \xB7 " + member.capabilities }, member.key)) })
      ] }),
      orphanCaps.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dlt-caps", "data-teams-caps": "", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dlt-capsHead", children: t("teams.declaredOnlyFold", { count: orphanCaps.length }) }),
        orphanCaps.map((row) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dlt-capsRow", title: row.id, children: row.id + " \xB7 " + row.capabilities.join(" / ") }, row.id))
      ] }),
      malformed === null ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.err, children: malformed })
    ] }),
    peers.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.cardTitle, children: t("teams.peers.title") }),
      peers.map((peer) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.grow, children: peer.label }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.chip(peer.state === "granted"), children: peer.state })
      ] }, peer.key))
    ] }),
    quarantine.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.cardTitle, children: t("teams.quarantine.title", { count: quarantine.length }) }),
      quarantine.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { ...S.row, flexWrap: "wrap" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.dot("#e05252") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.grow, title: entry.label, children: entry.label }),
        entry.reason === null ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.chip(false), children: entry.reason }),
        entry.task === null ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.meta, children: entry.task })
      ] }, entry.key))
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.cardTitle, children: [
        t("teams.stream.title"),
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.meta, children: t("teams.stream.subtitle", { count: stream.length }) })
      ] }),
      hiddenRecords === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.meta, "data-teams-hidden-records": hiddenRecords, children: t("teams.stream.hidden", { count: hiddenRecords }) }),
      stream.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.meta, children: t("teams.stream.empty") }) : stream.map((record) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.row, "data-net-target": record.actors.join(" "), children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.chip(false), children: record.kind }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.grow, children: record.label }),
        record.fixture ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.chip(true), children: t("teams.fixture") }) : null,
        record.state === null ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.meta, children: record.state })
      ] }, record.key))
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.meta, children: t("teams.footer", { seen }) })
  ] });
}
function TeamsTitle(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 4 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Glyph, { size: 14 }),
    props.t("teams.title")
  ] });
}
function localeService(ctx) {
  const strict = safe(() => typeof ctx.get === "function" ? ctx.get("locale") : null, null);
  if (strict !== null && strict !== void 0) return strict;
  const direct = safe(() => ctx.locale, null);
  return direct === null || direct === void 0 ? null : direct;
}
function bindTranslate(ctx) {
  const service = localeService(ctx);
  const bind = service === null ? void 0 : service.bind;
  if (typeof bind === "function") {
    try {
      return bind.call(service, NS);
    } catch {
    }
  }
  return (key, params) => {
    const template = zh[key] ?? key;
    if (params === void 0) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
  };
}
function safe(step, fallback) {
  try {
    return step();
  } catch {
    return fallback;
  }
}
function messageOf(error) {
  const held = error;
  return held !== null && held !== void 0 && held.message !== void 0 ? String(held.message) : String(error);
}
function markPanel(fields) {
  safe(() => {
    const held = globalThis[PANEL_MARKER];
    const base = held !== null && typeof held === "object" ? held : {};
    globalThis[PANEL_MARKER] = Object.assign({}, base, fields, { mounted: true });
  }, void 0);
}
function markDeclaration(declared, failed, tabType) {
  markPanel({
    id: PANEL_ITEM_ID,
    kind: PANEL_ITEM_KIND,
    source: PANEL_ITEM_SOURCE,
    ns: NS,
    tabId: tabType.id,
    tabKind: tabType.kind,
    declared,
    failed
  });
}
function markInvoke(result) {
  PANEL_INVOKES += 1;
  markPanel({ invokes: PANEL_INVOKES, lastInvoke: result });
}
function serviceOf(ctx, name, method) {
  const read = (value) => {
    if (value === null || value === void 0) return null;
    const held = value;
    return typeof held[method] === "function" ? held : null;
  };
  const fromGet = safe(() => typeof ctx.get === "function" ? ctx.get(name) : null, null);
  const strict = read(fromGet);
  if (strict !== null) return strict;
  return read(safe(() => ctx[name], null));
}
function linkPanelService(ctx) {
  return serviceOf(ctx, LINK_PANEL_SERVICE, "declare");
}
function sidebarRightService(ctx) {
  return serviceOf(ctx, SIDEBAR_RIGHT_SERVICE, "openTab");
}
function openOwnTab(ctx, tabType) {
  const service = sidebarRightService(ctx);
  if (service === null) {
    markInvoke({ ok: false, kind: tabType.kind, failed: "sidebarRight-unavailable: this page offers no " + SIDEBAR_RIGHT_SERVICE + " service, so the team panel was not opened" });
    return;
  }
  try {
    service.openTab(tabType.kind);
    markInvoke({ ok: true, kind: tabType.kind, failed: null });
  } catch (error) {
    markInvoke({ ok: false, kind: tabType.kind, failed: "openTab-refused: " + messageOf(error) });
  }
}
function panelItemDefinition(ctx, t, tabType) {
  return {
    id: PANEL_ITEM_ID,
    kind: PANEL_ITEM_KIND,
    source: PANEL_ITEM_SOURCE,
    order: PANEL_ITEM_ORDER,
    title: () => t("teams.panel.action"),
    invoke: () => openOwnTab(ctx, tabType)
  };
}
function releasePanelItem(disposer) {
  safe(() => {
    if (typeof disposer === "function") {
      disposer();
      return;
    }
    const loose = disposer;
    if (loose !== null && typeof loose === "object" && typeof loose.dispose === "function") loose.dispose();
  }, void 0);
}
function declarePanelItem(ctx, t, tabType, locale) {
  const service = linkPanelService(ctx);
  if (service === null) {
    markDeclaration(false, "linkPanel-unavailable: this page offers no " + LINK_PANEL_SERVICE + " service, so the team panel action was not declared", tabType);
    return () => {
    };
  }
  let disposer = null;
  try {
    disposer = service.declare(panelItemDefinition(ctx, t, tabType));
  } catch (error) {
    markDeclaration(false, "linkPanel-declare-refused: " + messageOf(error), tabType);
    return () => {
    };
  }
  markDeclaration(true, null, tabType);
  const notify = service.notify;
  let off = null;
  if (locale !== null && typeof locale.subscribe === "function" && typeof notify === "function") {
    safe(() => {
      off = locale.subscribe(() => {
        safe(() => notify.call(service), void 0);
      });
    }, void 0);
  }
  return () => {
    const unsubscribe = off;
    off = null;
    safe(() => {
      if (typeof unsubscribe === "function") unsubscribe();
    }, void 0);
    releasePanelItem(disposer);
  };
}
function registerPanelItem(ctx, t, tabType, locale) {
  if (typeof ctx.effect === "function") {
    let ran = false;
    try {
      ctx.effect(() => {
        ran = true;
        const dispose = declarePanelItem(ctx, t, tabType, locale);
        return () => dispose();
      }, "dsh-link-teams: panel action");
      return;
    } catch (error) {
      if (ran) return;
      safe(() => console.warn("[dsh-link-teams] ctx.effect failed for the panel action", messageOf(error)), void 0);
    }
  }
  safe(() => declarePanelItem(ctx, t, tabType, locale), void 0);
}
async function kernelRuntime() {
  try {
    const answer = await fetch("/api/session/list", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "client-request",
        rpcId: "dlt-runtime-" + String(Date.now()) + "-" + String(Math.random()).slice(2, 8),
        method: "session/list",
        payload: { args: { _request: {} } }
      })
    });
    if (!answer.ok) return null;
    const body = await answer.json();
    if (body.result?.ok !== true) return null;
    const map = {};
    for (const item of body.result.value?.items ?? []) {
      if (typeof item.sessionId === "string" && item.sessionId !== "") map[item.sessionId] = item.running === true;
    }
    return map;
  } catch {
    return null;
  }
}
function TeamPanelAction() {
  const [open, setOpen] = (0, import_react2.useState)(false);
  const [doc, setDoc] = (0, import_react2.useState)(null);
  const [runtime, setRuntime] = (0, import_react2.useState)(null);
  const [anchor, setAnchor] = (0, import_react2.useState)(null);
  const trigger = (0, import_react2.useRef)(null);
  const popover = (0, import_react2.useRef)(null);
  const close = (0, import_react2.useCallback)(() => setOpen(false), []);
  (0, import_react2.useEffect)(() => {
    if (!open) return void 0;
    let live = true;
    const load = () => {
      void fetch("/api/dsh-link-teams/state", { headers: { accept: "application/json" } }).then((answer) => answer.ok ? answer.json() : null).then((body) => {
        if (live && body !== null) setDoc(body);
      }).catch(() => {
      });
    };
    load();
    const timer = setInterval(load, 3e3);
    let runtimeLive = true;
    const loadRuntime = () => {
      void kernelRuntime().then((map) => {
        if (runtimeLive && map !== null) setRuntime(map);
      }).catch(() => {
      });
    };
    loadRuntime();
    const runtimeTimer = setInterval(loadRuntime, 2e3);
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (rect === void 0) return;
      const width = 392;
      const margin = 12;
      const left = Math.min(Math.max(margin, rect.left - width + rect.width), Math.max(margin, window.innerWidth - width - margin));
      setAnchor({ top: rect.bottom + 8, left });
    };
    place();
    const onDown = (event) => {
      const target = event.target;
      if (popover.current?.contains(target) === true || trigger.current?.contains(target) === true) return;
      close();
    };
    const onKey = (event) => {
      if (event.key === "Escape") close();
    };
    const onResize = () => {
      close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close]);
  const me = (() => {
    try {
      return currentSessionId();
    } catch (error) {
      return null;
    }
  })();
  const members = Array.isArray(doc?.members) ? doc?.members : [];
  const mine = me === null ? 0 : members.filter((member) => member.team === me).length;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "inline-flex" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
      "button",
      {
        type: "button",
        ref: trigger,
        "data-agent-team-replacement": "",
        className: "dlt-headAction",
        "data-open": open ? "true" : "false",
        title: "\u667A\u80FD\u4F53\u56E2\u961F",
        onClick: () => setOpen((v) => !v),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.IconUsersOutlineRegular, { width: 14, height: 14 }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: "\u667A\u80FD\u4F53\u56E2\u961F" }),
          mine > 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dlt-headActionCount", children: mine }) : null
        ]
      }
    ),
    open && anchor !== null && typeof document !== "undefined" ? (0, import_react_dom.createPortal)(
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
        "div",
        {
          ref: popover,
          className: "dlt-headPopover",
          "data-agent-team-popover": "",
          style: { position: "fixed", top: anchor.top, left: anchor.left, right: "auto", width: 392, maxHeight: 560, overflow: "auto", zIndex: 2147483e3 },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dlt-headPopoverTitle", children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: "\u56E2\u961F\u7ED3\u6784" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: mine === 0 ? "\u672C\u4F1A\u8BDD\u6682\u65E0\u961F\u53CB" : "\u672C\u4F1A\u8BDD " + String(mine) + " \u540D" })
            ] }),
            doc === null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { color: "var(--dsw-alias-label-tertiary, #8b929c)", fontSize: 11 }, children: "\u6B63\u5728\u8BFB\u53D6\u8D26\u672C\u2026" }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(TeamMindmap, { teams: doc.teams, members: doc.members, onOpen: openTeamSession, runtime })
          ]
        }
      ),
      document.body
    ) : null
  ] });
}
function apply(ctx) {
  const t = bindTranslate(ctx);
  const locale = localeService(ctx);
  ctx.effect(() => {
    if (typeof document === "undefined") return void 0;
    const tag = document.createElement("style");
    tag.dataset.pluginCss = "dsh-link-teams/teams.css";
    tag.textContent = teams_default;
    document.head.appendChild(tag);
    return () => {
      try {
        tag.remove();
      } catch (error) {
      }
    };
  }, "dsh-link-teams: pane stylesheet");
  ctx.effect(() => {
    if (locale === null || typeof locale.register !== "function") {
      markPanel({ dictionaries: "locale-unavailable: this page offers no locale service, so this package dictionaries were not registered" });
      return void 0;
    }
    const registered = locale.register(NS, { zh, en });
    markPanel({ dictionaries: "registered" });
    return registered;
  }, "dsh-link-teams: dictionaries");
  const tabType = {
    id: TAB_ID,
    kind: TAB_KIND,
    priority: "builtin",
    title: () => t("teams.title"),
    guide: [
      {
        order: 30,
        title: () => t("teams.title"),
        description: () => t("teams.guide"),
        icon: Glyph
      }
    ]
  };
  const sessionCandidates = {
    get: (() => {
      try {
        return typeof ctx.get === "function" ? ctx.get("sessions") : void 0;
      } catch (error) {
        return null;
      }
    })(),
    prop: ctx.sessions,
    reflectGet: (() => {
      try {
        const reflect = ctx.reflect;
        return reflect !== void 0 && typeof reflect.get === "function" ? reflect.get("sessions") : void 0;
      } catch (error) {
        return null;
      }
    })(),
    rootGet: (() => {
      try {
        const root = ctx.root;
        return root !== void 0 && typeof root.get === "function" ? root.get("sessions") : void 0;
      } catch (error) {
        return null;
      }
    })()
  };
  const seen = Object.keys(sessionCandidates).filter((key) => sessionCandidates[key] !== void 0 && sessionCandidates[key] !== null);
  const sessions = seen.length > 0 ? sessionCandidates[seen[0]] : null;
  const navBridge = globalThis.__dshSessionNav;
  markPanel({ navBridge: navBridge === void 0 ? "absent" : "present" });
  if (sessions !== null && typeof sessions.open === "function") {
    const open = sessions.open.bind(sessions);
    openSessionById = (id) => {
      open(id);
    };
    markPanel({ sessionSelection: "available", sessionSource: seen.join(",") });
  } else {
    openSessionById = null;
    markPanel({ sessionSelection: "unavailable: this page exposes no sessions service", sessionSeen: Object.keys(sessionCandidates).join(",") });
  }
  ctx.effect(() => ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register(
    { name: "conversation.session.header.actions", id: "link-teams-structure", order: -20, locale: NS },
    TeamPanelAction
  )), "dsh-link-teams: sidebar-style team panel in the shipped position");
  ctx.effect(() => ctx.sidebarRightTabs.register(tabType), "dsh-link-teams: rail tab type");
  ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register(
    { name: "sidebar.right.pane.tab", key: TAB_ID, locale: NS },
    TeamsBody
  )), "dsh-link-teams: pane body");
  ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register(
    { name: "sidebar.right.pane.tab.title", key: TAB_ID, locale: NS },
    TeamsTitle
  )), "dsh-link-teams: pane title");
  registerPanelItem(ctx, t, tabType, locale);
}

return module.exports; } });
