/**
 * Locale dictionaries for the plugin-manager's official-page patch. The zh
 * dictionary is the key source; the en dictionary mirrors the exact key set.
 *
 * The key set covers only what this package still renders: the
 * check-for-updates block on a bundle's page in the official Plugins panel.
 * The former tab's keys (inventory, conflicts, repair seeds, safe mode,
 * aggregate children) left with that tab.
 * @module @linxin666/dsh-client-ui-plugin-manager/client
 */

/** Simplified Chinese copy (the key-set source of truth). */
const STATIC_ZH = {
  'updateSection': '更新',
  'checkUpdates': '检查更新',
  'checking': '检查中…',
  'noUpdates': '已是最新版本。',
  'update': '更新',
  'updating': '更新中…',
  'latest': '最新 {version}',
  'updateRequiresDsh': '需要 DSH ≥ {min}',
  'updateBlockedDsh': '需要 DSH ≥ {min}，请先升级 DSH 再更新',
  'restartHint': '插件变更将在重启应用后生效。',
  'failed': '操作失败：{reason}',
  'fetching': '正在获取插件信息…',
  'downloading': '正在下载…',
  'downloadingPercent': '正在下载 {percent}%',
  'extracting': '正在解压…',
  'writing': '正在写入配置…',
  'localOnlyTitle': '仅限本机操作',
  'localOnlyBody': '为了保护主机配置，插件管理只能从本机打开。'
} satisfies Record<string, string>

/** English copy, checked complete against the zh key set. */
const STATIC_EN = {
  'updateSection': 'Update',
  'checkUpdates': 'Check for updates',
  'checking': 'Checking…',
  'noUpdates': 'The installed version is the latest.',
  'update': 'Update',
  'updating': 'Updating…',
  'latest': 'Latest {version}',
  'updateRequiresDsh': 'Requires DSH >= {min}',
  'updateBlockedDsh': 'Requires DSH >= {min}; upgrade DSH before updating',
  'restartHint': 'Plugin changes take effect after restarting the application.',
  'failed': 'Operation failed: {reason}',
  'fetching': 'Fetching plugin metadata…',
  'downloading': 'Downloading…',
  'downloadingPercent': 'Downloading {percent}%',
  'extracting': 'Extracting…',
  'writing': 'Writing configuration…',
  'localOnlyTitle': 'Available on this computer only',
  'localOnlyBody': 'To protect host configuration, plugin management is only available from a local browser.'
} satisfies Record<keyof typeof STATIC_ZH, string>

export const zh = STATIC_ZH
export const en = STATIC_EN
export type PluginManagerKey = keyof typeof STATIC_ZH
