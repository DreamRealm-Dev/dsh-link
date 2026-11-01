/** `settings.theme-style` namespace dictionaries (the Theme section's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'nav': '主题',
  'controlStyle.title': '控件风格',
  'controlStyle.description': '按钮、输入框与浮动面板的材质。切换立即生效，界面其余部分保持不变。',
  'controlStyle.official': '官方默认',
  'controlStyle.officialHint': '客户端自带材质',
  'controlStyle.liquidGlass': '液态玻璃',
  'controlStyle.liquidGlassHint': 'Apple Liquid Glass',
  'controlStyle.failed': '未能保存，风格保持不变',
  'glassPreset.title': '皮肤预设',
  'glassPreset.description': '液态玻璃皮肤的两种排布。Tahoe 让侧边栏浮在内容之外，Golden Gate 让它与内容齐平。切换立即生效，已打开的菜单与对话框一并跟随。',
  'glassPreset.tahoe': 'Tahoe',
  'glassPreset.tahoeHint': 'macOS 26 · 浮起的玻璃层',
  'glassPreset.goldenGate': 'Golden Gate',
  'glassPreset.goldenGateHint': 'macOS 27 · 与内容齐平一体',
  'glassPreset.failed': '未能保存，预设保持不变',
  'glassPreset.skinOff': '预设属于液态玻璃皮肤：选择「液态玻璃」后可切换。',
  'transparency.title': '透明度',
  'transparency.description': 'Golden Gate 的三档透明度，作用在玻璃的填充与模糊上，不改变任何几何参数。中间一档是默认值。',
  'transparency.clear': '清晰',
  'transparency.default': '默认',
  'transparency.tinted': '加浓',
  'transparency.failed': '未能保存，透明度保持不变',
  'radius.title': '统一圆角',
  'radius.description': '窗口与窗口内所有面板共用同一个圆角。拖动时即时预览，松手即保存，并同步到窗口外壳的自绘圆角。',
} satisfies Record<string, string>

/** The settings.theme-style namespace key union. */
export type ThemeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'nav': 'Theme',
  'controlStyle.title': 'Control style',
  'controlStyle.description': 'The material of buttons, inputs and floating panels. Switching applies at once; nothing else about the interface changes.',
  'controlStyle.official': 'Official',
  'controlStyle.officialHint': 'The client\u2019s own material',
  'controlStyle.liquidGlass': 'Liquid Glass',
  'controlStyle.liquidGlassHint': 'Apple Liquid Glass',
  'controlStyle.failed': 'Not saved; the current style is unchanged',
  'glassPreset.title': 'Skin preset',
  'glassPreset.description': 'Two arrangements of the liquid glass skin. Tahoe floats the sidebar outside the content; Golden Gate runs it flush into the content. Switching applies at once, open menus and dialogs included.',
  'glassPreset.tahoe': 'Tahoe',
  'glassPreset.tahoeHint': 'macOS 26 \u00b7 a floating glass layer',
  'glassPreset.goldenGate': 'Golden Gate',
  'glassPreset.goldenGateHint': 'macOS 27 \u00b7 edge-to-edge with the content',
  'glassPreset.failed': 'Not saved; the current preset is unchanged',
  'glassPreset.skinOff': 'Presets belong to the liquid glass skin: pick Liquid Glass to switch them.',
  'transparency.title': 'Transparency',
  'transparency.description': 'Golden Gate\u2019s three transparency steps, applied to the glass\u2019s fill and blur \u2014 never to a geometric token. The middle step is the default.',
  'transparency.clear': 'Clear',
  'transparency.default': 'Default',
  'transparency.tinted': 'Tinted',
  'transparency.failed': 'Not saved; the current step is unchanged',
  'radius.title': 'Corner radius',
  'radius.description': 'One radius for the window and every panel inside it. Dragging previews it at once; releasing saves it and syncs the shell\u2019s own corner.',
} satisfies Record<ThemeKey, string>
