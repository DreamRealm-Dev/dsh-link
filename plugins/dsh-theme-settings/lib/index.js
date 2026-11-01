// plugins/dsh-theme-settings/src/index.ts
import z from "@deepseek-ai/schemastery";

// plugins/dsh-theme-settings/src/settings.ts
var SETTINGS_NAMESPACE = "theme-settings";
var CONTROL_STYLE_FIELD = "controlStyle";
var RADIUS_FIELD = "radius";
var RADIUS_MIN = 0;
var RADIUS_MAX = 28;
var DEFAULT_RADIUS = 12;
function clampRadius(value) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) return DEFAULT_RADIUS;
  return Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, Math.round(parsed)));
}
var CONTROL_STYLES = ["official", "liquid-glass"];
var DEFAULT_CONTROL_STYLE = "official";
function isControlStyle(value) {
  return CONTROL_STYLES.some((style) => style === value);
}
var GLASS_PRESETS = ["tahoe", "golden-gate"];
var DEFAULT_GLASS_PRESET = "tahoe";
function isGlassPreset(value) {
  return GLASS_PRESETS.some((preset) => preset === value);
}
var GLASS_TRANSPARENCY_STEPS = ["clear", "default", "tinted"];
var DEFAULT_GLASS_TRANSPARENCY = "default";
var TRANSPARENCY_PRESET = "golden-gate";
function isGlassTransparency(value) {
  return GLASS_TRANSPARENCY_STEPS.some((step) => step === value);
}
var GLASS_PRESET_FIELD = "glassPreset";
var GLASS_TRANSPARENCY_FIELD = "glassTransparency";
var GLASS_PRESET_ATTRIBUTE = "data-lg-preset";
var GLASS_TRANSPARENCY_ATTRIBUTE = "data-lg-transparency";

// plugins/dsh-theme-settings/src/index.ts
var Config = z.object({
  controlStyle: z.union([...CONTROL_STYLES]).default(DEFAULT_CONTROL_STYLE).volatile(),
  radius: z.number().min(RADIUS_MIN).max(RADIUS_MAX).default(DEFAULT_RADIUS).volatile(),
  glassPreset: z.union([...GLASS_PRESETS]).default(DEFAULT_GLASS_PRESET).volatile(),
  glassTransparency: z.union([...GLASS_TRANSPARENCY_STEPS]).default(DEFAULT_GLASS_TRANSPARENCY).volatile()
});
var name = "theme-settings";
function apply() {
}
export {
  CONTROL_STYLES,
  CONTROL_STYLE_FIELD,
  Config,
  DEFAULT_CONTROL_STYLE,
  DEFAULT_GLASS_PRESET,
  DEFAULT_GLASS_TRANSPARENCY,
  DEFAULT_RADIUS,
  GLASS_PRESETS,
  GLASS_PRESET_ATTRIBUTE,
  GLASS_PRESET_FIELD,
  GLASS_TRANSPARENCY_ATTRIBUTE,
  GLASS_TRANSPARENCY_FIELD,
  GLASS_TRANSPARENCY_STEPS,
  RADIUS_FIELD,
  RADIUS_MAX,
  RADIUS_MIN,
  SETTINGS_NAMESPACE,
  TRANSPARENCY_PRESET,
  apply,
  clampRadius,
  isControlStyle,
  isGlassPreset,
  isGlassTransparency,
  name
};
