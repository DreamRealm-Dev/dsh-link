//! The client bridge the shell injects into the official client's document.
//!
//! The official client gates every Desktop-only surface on one page global,
//! `window.dshDesktop`: account sign-in, the login bonus notice, the account
//! quota notice, the account settings page, and the first-run onboarding. The
//! Desktop shell supplies it from its Electron preload. A page served over HTTP has
//! no preload, so the proxy injects this same-origin script instead.
//!
//! The value is the stub the official preload itself exposes to frames it does not
//! own (`apps/desktop/src/preload-app.ts`): a bare `{ protocolVersion: 1 }`. Every
//! account operation that then appears travels the kernel's own Remote API, which the
//! Web profile already mounts, so the script grants no credential, no IPC surface and
//! no capability the document did not already have as a same-origin page.
//!
//! Two more page-side gaps are filled here because a proxy has no shell API behind
//! it: an external link has to reach the system browser, and the official onboarding
//! asks whether a model credential exists before it decides to run.

use std::path::Path;

/// Path the bridge script is served from. Same origin as the page, so the client's
/// own CSP covers it and no remote-domain permission is involved.
pub const BRIDGE_PATH: &str = "/__shell/bridge.js";

/// Path the bridge asks whether a model credential is configured.
pub const HAS_API_KEY_PATH: &str = "/__shell/has-api-key";

/// Path the page posts an external link to.
pub const OPEN_PATH: &str = "/__shell/open";

/// Marker inside a Platform authorization URL. Matching on the host and route rather
/// than on the whole URL keeps a query the platform adds from breaking the match.
const AUTHORIZE_MARKER: &str = "platform.deepseek.com/dsh/authorize";

/// The script the proxy injects into the kernel's index.
///
/// Plain ES5 on purpose: it runs before the client boots and must not depend on a
/// build step or on any bundle the kernel serves.
pub const BRIDGE_SCRIPT: &str = r##"/* DSH Link: the Desktop surfaces the official client gates on one global. */
(function () {
  if (globalThis.dshDesktop === undefined) {
    globalThis.dshDesktop = { protocolVersion: 1 };
  }
  if (globalThis.dshOnboarding === undefined) {
    globalThis.dshOnboarding = {
      hasApiKey: function () {
        return fetch('/__shell/has-api-key', { credentials: 'same-origin' })
          .then(function (response) { return response.json(); })
          .then(function (body) { return body === true; })
          .catch(function () { return false; });
      },
      setActive: function () {},
    };
  }
  // The account menu carries one entry that leads to DeepSeek's own questionnaire.
  // This install is not DeepSeek, so the entry is removed instead of being left to send
  // users somewhere that does not belong to this project. A click that still reaches the
  // row's handler is swallowed. Only the copy is matched: an upstream rename makes the
  // entry reappear, and nothing else changes.
  //
  // The row has to be gone *before the client measures the panel*. The client reads the
  // menu's offsetHeight in a layout effect that runs in the same commit that inserts the
  // rows, and a MutationObserver callback is a microtask: it arrives after that commit's
  // layout effects. An observer therefore always hears about the row too late — the client
  // has already placed the panel from a three-row height, and the first painted frame sits
  // exactly one row (34px) too high until the client re-places it. Refusing the insertion
  // instead gives the client the same two-row dom it would have measured if the entry had
  // never existed, so the first frame is already settled.
  var CONTACT_LABELS = ['意见反馈', 'Feedback'];
  function contactRow(node) {
    if (!node || node.nodeType !== 1 || node.tagName !== 'BUTTON' || !node.getAttribute) return false;
    if (node.getAttribute('role') !== 'menuitem') return false;
    return typeof node.textContent === 'string' && CONTACT_LABELS.indexOf(node.textContent.trim()) !== -1;
  }
  // A refused insertion leaves the client holding a node that is not in the document. The
  // client removes the panel by its top-level node and never walks the dom to find a row, so
  // the one reachable consequence is a later insertBefore that names the refused node as its
  // reference: the native call would throw NotFoundError inside the client's own commit, which
  // is worse than the jump this replaces. A reference node that is not a child of the parent
  // it is inserted into cannot be honoured, so it is dropped and the node is appended.
  function refuseInFragment(fragment) {
    var children = fragment.childNodes;
    for (var i = children.length - 1; i >= 0; i--) {
      if (contactRow(children[i])) fragment.removeChild(children[i]);
    }
  }
  var appendChild = Node.prototype.appendChild;
  var insertBefore = Node.prototype.insertBefore;
  Node.prototype.appendChild = function (node) {
    if (contactRow(node)) return node;
    if (node && node.nodeType === 11) refuseInFragment(node);
    return appendChild.call(this, node);
  };
  Node.prototype.insertBefore = function (node, ref) {
    if (contactRow(node)) return node;
    if (node && node.nodeType === 11) refuseInFragment(node);
    if (ref && ref.parentNode !== this) ref = null;
    return insertBefore.call(this, node, ref);
  };
  // The net, not the fix: a path the wrappers above do not see (innerHTML, Element.append, a
  // subtree that arrives already carrying the row) still loses the row here, only too late to
  // keep the first frame settled.
  function sweepMenus() {
    var menus = document.querySelectorAll('[role="menu"]');
    for (var m = 0; m < menus.length; m++) {
      var rows = menus[m].querySelectorAll('button[role="menuitem"]');
      for (var i = 0; i < rows.length; i++) {
        if (contactRow(rows[i])) rows[i].remove();
      }
    }
  }
  // Whether a node a mutation batch added is a menu, holds one, or landed inside a menu
  // that was already mounted, which is a client that mounts the panel and its rows in
  // separate commits. All three have to be gone before the next paint.
  function touchesMenu(node) {
    if (!node) return false;
    if (node.matches && node.matches('[role="menu"]')) return true;
    if (node.querySelector && node.querySelector('[role="menu"]')) return true;
    return !!(node.closest && node.closest('[role="menu"]'));
  }
  var sweepPending = false;
  function scheduleSweep() {
    if (sweepPending) return;
    sweepPending = true;
    // Coalesced to one pass per frame: the observer watches the whole document, and the
    // query stays scoped to open menus.
    requestAnimationFrame(function () { sweepPending = false; sweepMenus(); });
  }
  document.addEventListener('click', function (event) {
    var row = event.target instanceof Element ? event.target.closest('button[role="menuitem"]') : null;
    if (!contactRow(row)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    sweepMenus();
  }, true);
  // A batch is delivered once and lists what was inserted, and the DOM it describes is
  // already complete when the callback runs, so one sweep covers the whole batch. A row the
  // insertion wrappers above refused never appears in such a batch, so this path can only fire
  // for a row that reached the dom by some other route. The removals the sweep itself makes
  // come back as later batches that added nothing, so this path cannot repeat for the same
  // insertion; a batch with no menu in it, which is every ordinary mutation, keeps the
  // one-pass-per-frame coalescing.
  new MutationObserver(function (mutations) {
    for (var m = 0; m < mutations.length; m++) {
      var added = mutations[m].addedNodes;
      for (var n = 0; n < added.length; n++) {
        if (touchesMenu(added[n])) { sweepMenus(); return; }
      }
    }
    scheduleSweep();
  }).observe(document.documentElement, { childList: true, subtree: true });

  var open = window.open;
  window.open = function (url) {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      void fetch('/__shell/open', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: url }),
      }).catch(function () {});
      return null;
    }
    return open.apply(this, arguments);
  };
})();
"##;

/// The Platform authorization URL carried by one relayed kernel frame.
///
/// The kernel hands the client an `authorizeUrl` when a sign-in attempt reaches
/// `waiting-browser`; the Desktop shell opens it from its main process. Behind a
/// proxy there is no such channel, so the URL is read from the frame the kernel
/// already sends this window. A frame this does not recognize costs only the
/// automatic open: the sign-in dialog still offers the same link to copy.
///
/// # Arguments
///
/// * `payload` - one relayed frame, decoded as UTF-8 text.
pub fn authorize_url(payload: &str) -> Option<String> {
    let start = payload.find(AUTHORIZE_MARKER)?;
    let head = payload[..start].rfind("https://")?;
    let rest = &payload[head..];
    let end = rest
        .find(|c: char| {
            c == '"' || c == '\\' || c == '<' || c == '>' || c == ' ' || c.is_whitespace()
        })
        .unwrap_or(rest.len());
    Some(rest[..end].to_owned())
}

/// Whether any credential reference in the kernel home holds a value.
///
/// This is the fact the official onboarding's credential probe reports: the Desktop
/// welcome backend answers `hasApiKey` from configured credential records, not from
/// a model list. An unreadable or absent document answers `false`, which runs the
/// onboarding rather than skipping it.
///
/// # Arguments
///
/// * `home` - the kernel's `DSH_HOME`.
pub fn api_key_configured(home: &Path) -> bool {
    let Ok(document) = std::fs::read_to_string(home.join(".credentials.yaml")) else {
        return false;
    };
    let Ok(parsed) = serde_yaml::from_str::<serde_yaml::Value>(&document) else {
        return false;
    };
    let Some(refs) = parsed.get("refs").and_then(|value| value.as_mapping()) else {
        return false;
    };
    refs.values().any(|value| match value {
        serde_yaml::Value::String(text) => !text.is_empty(),
        serde_yaml::Value::Null => false,
        _ => true,
    })
}

/// Whether a binary frame can carry an authorization URL at all.
///
/// A byte scan with no allocation: the relay is on the path of every event frame and
/// the common case is a payload that can never contain one.
///
/// # Arguments
///
/// * `bytes` - one relayed frame.
pub fn may_carry_authorize_url(bytes: &[u8]) -> bool {
    bytes.len() >= AUTHORIZE_MARKER.len()
        && bytes
            .windows(AUTHORIZE_MARKER.len())
            .any(|window| window == AUTHORIZE_MARKER.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The part of the injected script that installs a behaviour, located by the call
    /// that installs it rather than by the statements inside: renaming or rewriting what a
    /// callback does should not fail a test that only cares which callback does it.
    fn injected_region(from: &str, to: &str) -> &'static str {
        let start = BRIDGE_SCRIPT
            .find(from)
            .unwrap_or_else(|| panic!("the bridge no longer contains {from:?}"));
        let rest = &BRIDGE_SCRIPT[start..];
        let end = rest
            .find(to)
            .unwrap_or_else(|| panic!("the bridge no longer contains {to:?} after {from:?}"));
        &rest[..end]
    }

    #[test]
    fn the_injected_script_suppresses_the_feedback_entry_by_its_copy() {
        // Both spellings the client ships, and menu rows rather than any text on the page:
        // the match is a button element whose role is menuitem and whose text is the copy.
        assert!(BRIDGE_SCRIPT.contains("意见反馈"));
        assert!(BRIDGE_SCRIPT.contains("Feedback"));
        assert!(BRIDGE_SCRIPT.contains("button[role=\"menuitem\"]"));
        assert!(BRIDGE_SCRIPT.contains("node.tagName !== 'BUTTON'"));
        assert!(BRIDGE_SCRIPT.contains("node.getAttribute('role') !== 'menuitem'"));
    }

    #[test]
    fn the_contact_row_is_refused_at_insertion_ahead_of_the_observer() {
        // The client measures the panel in a layout effect that runs in the commit which
        // inserts the rows, so a row that reaches the document is measured before any observer
        // callback can run. The refusal has to be in the insertion itself, installed ahead of
        // the observer that sweeps.
        let refuse = injected_region("function contactRow", "function sweepMenus");
        assert!(refuse.contains("Node.prototype.appendChild"));
        assert!(refuse.contains("Node.prototype.insertBefore"));
        assert!(refuse.contains("if (contactRow(node)) return node;"));
        assert!(refuse.contains("refuseInFragment"));
        assert!(
            BRIDGE_SCRIPT.find("Node.prototype.appendChild").unwrap()
                < BRIDGE_SCRIPT.find("new MutationObserver(").unwrap(),
            "the insertion refusal has to be installed before the observer"
        );
    }

    #[test]
    fn a_reference_the_client_no_longer_holds_is_never_passed_to_insert_before() {
        // The refused row stays in the client's own tree, so a later insertBefore can still
        // name it as its reference. Passing that through would throw NotFoundError inside the
        // client's commit, which is worse than the placement this replaces.
        let guard = injected_region("Node.prototype.insertBefore", "// The net, not the fix");
        assert!(guard.contains("ref.parentNode !== this"));
        assert!(guard.contains("ref = null"));
    }

    #[test]
    fn a_menu_that_arrives_in_a_mutation_batch_is_swept_in_the_observer_callback() {
        // The row must be gone before the client can paint the panel it sits in, which only
        // the callback that observes the insertion can manage: it has to read the batch's
        // added nodes and sweep in the callback rather than on the next animation frame.
        let observer = injected_region("new MutationObserver(", ").observe(document.documentElement");
        assert!(observer.contains("addedNodes"));
        assert!(observer.contains("sweepMenus()"));
    }

    #[test]
    fn every_other_mutation_stays_coalesced_to_one_sweep_per_frame() {
        let schedule = injected_region("function scheduleSweep", "document.addEventListener('click'");
        assert!(schedule.contains("requestAnimationFrame"));
        assert!(schedule.contains("sweepPending"));
    }

    #[test]
    fn the_click_swallow_and_external_link_routing_are_unchanged() {
        assert!(BRIDGE_SCRIPT.contains("stopImmediatePropagation"));
        assert!(BRIDGE_SCRIPT.contains("'/__shell/open'"));
        assert!(BRIDGE_SCRIPT.contains("window.open"));
    }

    #[test]
    fn reads_the_authorize_url_out_of_a_frame() {
        let frame = r#"{"type":"remote","channel":"account","value":{"attempt":{"phase":"waiting-browser","authorizeUrl":"https://platform.deepseek.com/dsh/authorize?state=abc&theme=dark"}}}"#;
        assert_eq!(
            authorize_url(frame).as_deref(),
            Some("https://platform.deepseek.com/dsh/authorize?state=abc&theme=dark")
        );
    }

    #[test]
    fn ignores_frames_without_an_authorize_url() {
        assert_eq!(authorize_url(r#"{"phase":"idle"}"#), None);
        assert_eq!(authorize_url(""), None);
    }

    #[test]
    fn stops_at_the_json_escape_of_a_url() {
        let frame = r#"{"authorizeUrl":"https://platform.deepseek.com/dsh/authorize?state=a\u0026b=1","next":1}"#;
        assert_eq!(
            authorize_url(frame).as_deref(),
            Some("https://platform.deepseek.com/dsh/authorize?state=a")
        );
    }

    #[test]
    fn reads_configured_credential_refs() {
        let home = std::env::temp_dir().join("dsh-link-bridge-creds");
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).unwrap();
        assert!(!api_key_configured(&home));
        std::fs::write(
            home.join(".credentials.yaml"),
            "version: 1\nrecords:\n  client-connection/browser-session:\n    kind: cookie\nrefs:\n  OPENCODE_API_KEY: abc\n",
        )
        .unwrap();
        assert!(api_key_configured(&home));
        std::fs::write(home.join(".credentials.yaml"), "version: 1\nrefs:\n  EMPTY: \n").unwrap();
        assert!(!api_key_configured(&home));
        let _ = std::fs::remove_dir_all(&home);
    }
}
