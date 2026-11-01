/**
 * Interactive-control extraction, numbered markers, and human-like clicking.
 *
 * This is the "semantic" input mode that sits beside the coordinate mode. It
 * reads the page's interactive STRUCTURE (tags, ARIA roles, labels, boxes) — not
 * its source — and turns it into a short numbered list, so the model can act by
 * number instead of estimating pixel coordinates.
 *
 * Two properties matter for robustness:
 *   - numbering is per snapshot, and a click can be bound to the snapshot it was
 *     chosen from, so a control that moved between listing and clicking is
 *     rejected instead of silently clicking whatever now sits at that box;
 *   - the click point is jittered inside the control's own box (never its edge),
 *     which both looks human and tolerates small geometry drift.
 */

/** Selector for everything reasonably clickable/typable, including custom widgets. */
const CONTROL_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type=hidden])',
  'select',
  'textarea',
  'summary',
  '[contenteditable=true]',
  '[role=button]',
  '[role=link]',
  '[role=checkbox]',
  '[role=radio]',
  '[role=switch]',
  '[role=tab]',
  '[role=menuitem]',
  '[role=menuitemcheckbox]',
  '[role=menuitemradio]',
  '[role=option]',
  '[role=combobox]',
  '[role=textbox]',
  '[role=searchbox]',
  '[role=slider]',
  '[role=spinbutton]',
  '[role=treeitem]',
  '[onclick]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const MARKER_ID = '__dsh_browser_markers__'

/**
 * Build the page-side extraction expression.
 *
 * Runs in the page, returns only plain JSON scalars. Never returns page source:
 * each entry is a role, a truncated label, and a box.
 * @param max - upper bound on returned controls.
 */
export function extractionExpression(max) {
  return `(() => {
  const MAX = ${Number(max)};
  const SEL = ${JSON.stringify(CONTROL_SELECTOR)};
  const vw = window.innerWidth, vh = window.innerHeight;
  const label = (el) => {
    const aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const labelledby = el.getAttribute && el.getAttribute('aria-labelledby');
    if (labelledby) {
      const t = labelledby.split(/\\s+/).map((id) => { const n = document.getElementById(id); return n ? (n.textContent || '') : ''; }).join(' ').trim();
      if (t) return t;
    }
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      const ph = el.getAttribute('placeholder');
      if (ph && ph.trim()) return ph.trim();
      const alt = el.getAttribute('alt');
      if (alt && alt.trim()) return alt.trim();
      const ti = el.getAttribute('title');
      if (ti && ti.trim()) return ti.trim();
      const nm = el.getAttribute('name');
      if (nm && nm.trim() && (el.type === 'submit' || el.type === 'button' || el.type === 'reset')) return nm.trim();
      if (el.value && el.type !== 'password' && el.value.length <= 60) return String(el.value).trim();
      return (el.type || tag);
    }
    const ti = el.getAttribute('title');
    if (ti && ti.trim()) return ti.trim();
    const txt = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (txt) return txt;
    const alt = el.getAttribute('alt');
    if (alt && alt.trim()) return alt.trim();
    return '';
  };
  const roleOf = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'summary') return 'button';
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'submit' || t === 'button' || t === 'reset' || t === 'image') return 'button';
      if (t === 'checkbox' || t === 'radio') return t;
      if (t === 'range') return 'slider';
      if (t === 'number') return 'spinbutton';
      if (t === 'search') return 'searchbox';
      return 'textbox';
    }
    return 'generic';
  };
  const visible = (el, r) => {
    if (r.width < 4 || r.height < 4) return false;
    if (r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    if (Number(cs.opacity) < 0.15) return false;
    if (el.hasAttribute('disabled')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    return true;
  };
  const all = Array.from(document.querySelectorAll(SEL));
  const matched = new Set(all);
  const out = [];
  for (const el of all) {
    if (out.length >= MAX) break;
    if (!el.isConnected) continue;
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    // Drop an ancestor when a matched descendant covers it: the descendant is
    // the real control (e.g. [role=button] wrapping the actual <button>).
    let hasMatchedChild = false;
    for (const child of el.querySelectorAll(SEL)) { if (matched.has(child)) { hasMatchedChild = true; break; } }
    if (hasMatchedChild) continue;
    const role = roleOf(el);
    const text = label(el).replace(/\\s+/g, ' ').slice(0, 48);
    const entry = {
      r: role,
      t: text,
      b: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    };
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') { entry.k = (el.type || 'text').toLowerCase(); if (el.type === 'checkbox' || el.type === 'radio') entry.v = !!el.checked; }
    else if (tag === 'select') { entry.k = 'select'; entry.v = el.value; }
    else if (tag === 'textarea') entry.k = 'textarea';
    else if (el.isContentEditable) entry.k = 'editable';
    out.push(entry);
  }
  return { vw, vh, controls: out };
})()`
}

/** Install numbered badges + outlines for the current control list. */
export function markerExpression(controlCount) {
  return `(() => {
  const old = document.getElementById(${JSON.stringify(MARKER_ID)});
  if (old) old.remove();
  const host = document.createElement('div');
  host.id = ${JSON.stringify(MARKER_ID)};
  host.setAttribute('data-dsh-browser', 'markers');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;font:600 11px/1 ui-sans-serif,system-ui,sans-serif;';
  document.documentElement.appendChild(host);
  return { ok: true, count: ${Number(controlCount)} };
})()`
}

/**
 * Install the badges once the control list is known (page side).
 * @param controls - the extracted entries, already numbered by the caller.
 */
export function markerPaintExpression(controls) {
  const serialized = JSON.stringify(controls.map((c, i) => ({ n: i + 1, b: c.b })))
  return `(() => {
  const items = ${serialized};
  let host = document.getElementById(${JSON.stringify(MARKER_ID)});
  if (!host) return { ok: false };
  host.textContent = '';
  for (const it of items) {
    const [x, y, w, h] = it.b;
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px;'
      + 'border:1px solid rgba(255,64,64,.85);box-sizing:border-box;pointer-events:none;';
    const badge = document.createElement('span');
    badge.textContent = String(it.n);
    badge.style.cssText = 'position:fixed;left:' + x + 'px;top:' + Math.max(0, y - 1) + 'px;transform:translate(-50%,-50%);'
      + 'min-width:14px;height:14px;padding:0 3px;border-radius:8px;background:#ff4040;color:#fff;'
      + 'text-align:center;line-height:14px;box-sizing:border-box;pointer-events:none;';
    host.appendChild(box);
    host.appendChild(badge);
  }
  return { ok: true, painted: items.length };
})()`
}

export const MARKER_REMOVE_EXPRESSION = `(() => { const n = document.getElementById(${JSON.stringify(MARKER_ID)}); if (n) n.remove(); return { ok: true } })()`

/** A stable fingerprint of one entry, used to detect drift between list and click. */
export function controlKey(entry) {
  return `${entry.r}|${entry.t}|${entry.b[0]},${entry.b[1]},${entry.b[2]},${entry.b[3]}`
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/**
 * Pick a point inside a control box, inset from every edge, at a random offset.
 *
 * Insetting matters: the geometric centre of a control whose edge is overlapped
 * by a sibling can land on that sibling, and real pointers never hit the exact
 * centre twice. The returned point is always strictly inside the box.
 */
export function jitteredPoint(box, random = Math.random) {
  const [x, y, w, h] = box
  const insetX = Math.min(Math.max(2, w * 0.18), Math.max(0, w / 2 - 1))
  const insetY = Math.min(Math.max(2, h * 0.22), Math.max(0, h / 2 - 1))
  const px = x + insetX + random() * Math.max(0, w - insetX * 2)
  const py = y + insetY + random() * Math.max(0, h - insetY * 2)
  return [clamp(Math.round(px), x + 1, x + Math.max(1, w - 1)), clamp(Math.round(py), y + 1, y + Math.max(1, h - 1))]
}

/** A short, token-cheap rendering of one extraction. */
export function summarizeControls(snapshot, { snapshotId, includeBoxes = true } = {}) {
  const lines = snapshot.controls.map((c, i) => {
    const n = i + 1
    const kind = c.k === undefined ? c.r : `${c.r}/${c.k}`
    const bits = [`${n}`, kind]
    if (c.t) bits.push(JSON.stringify(c.t))
    if (c.v !== undefined && c.v !== false && c.v !== '') bits.push(`v=${JSON.stringify(c.v)}`)
    if (includeBoxes) bits.push(`@${c.b.join(',')}`)
    return bits.join(' ')
  })
  return [
    `snapshot=${snapshotId} viewport=${snapshot.vw}x${snapshot.vh} controls=${snapshot.controls.length}`,
    ...lines,
  ].join('\n')
}
