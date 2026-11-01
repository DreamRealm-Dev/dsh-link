// plugins/dsh-link-toolbar/src/client/toolbar-items.ts
var MARKERS = [
  { id: "layout", attribute: "data-dsh-link-layout" },
  { id: "notes", attribute: "data-dsh-link-notes" },
  { id: "glass", attribute: "data-dsh-link-glass" },
  { id: "browser", attribute: "data-dsh-browser" }
];
function toolbarItems(source) {
  return MARKERS.map((marker) => {
    const raw = source === null || source === void 0 ? null : source.getAttribute(marker.attribute);
    if (raw === null || raw === void 0) {
      return { id: marker.id, labelKey: "item." + marker.id, enabled: false, reason: "not-mounted", value: null };
    }
    if (raw === "") {
      return { id: marker.id, labelKey: "item." + marker.id, enabled: false, reason: "empty-value", value: null };
    }
    return { id: marker.id, labelKey: "item." + marker.id, enabled: true, reason: null, value: raw };
  });
}
var MARKER_ATTRIBUTES = MARKERS.map((marker) => marker.attribute);

// plugins/dsh-link-toolbar/src/index.ts
var name = "dsh-link-toolbar";
export {
  MARKER_ATTRIBUTES,
  name,
  toolbarItems
};
