/**
 * The `web-ui-plugins` locale dictionaries for the group card.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': 'Web 插件',
} satisfies Record<string, string>

/** Key union for this namespace. */
export type WebUIPluginsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'Web Plugins',
} satisfies Record<WebUIPluginsKey, string>
