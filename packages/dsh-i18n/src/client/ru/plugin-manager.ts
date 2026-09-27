/**
 * Russian dictionary for the "settings.pluginManager" locale namespace.
 * Source package: packages/dsh-plugin-manager (its zh dictionary is the key source).
 * Maintained centrally by the dsh-i18n language pack; when a zh key is added
 * or changed upstream, mirror it here and run `pnpm i18n:check`.
 */

export const ru: Record<string, string> = {
  'checkUpdates': 'Проверить обновления',
  'checking': 'Проверка…',
  'downloading': 'Скачивание…',
  'downloadingPercent': 'Скачивание: {percent}%',
  'extracting': 'Распаковка…',
  'failed': 'Не удалось выполнить операцию: {reason}.',
  'fetching': 'Получение сведений о плагине…',
  'latest': 'Последняя версия: {version}',
  'localOnlyBody': 'Для защиты конфигурации хоста управление плагинами доступно только из локального браузера.',
  'localOnlyTitle': 'Только на этом компьютере',
  'noUpdates': 'Установлена последняя версия.',
  'restartHint': 'Изменения плагинов вступят в силу после перезапуска приложения.',
  'update': 'Обновить',
  'updateBlockedDsh': 'Требуется DSH ≥ {min}; сначала обновите DSH, затем повторите попытку.',
  'updateRequiresDsh': 'Требуется DSH ≥ {min}',
  'updateSection': 'Обновление',
  'updating': 'Обновление…',
  'writing': 'Запись конфигурации…',
}
