/**
 * Minimal react-i18next shim for the standalone Craft editor.
 * The copied editor components call useTranslation() with a handful of keys;
 * we resolve them from a small dictionary instead of pulling in i18next.
 */

import { useCallback } from 'react'

const dict: Record<string, string> = {
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.copyAll': 'Copy all',
  'common.copyCode': 'Copy code',
  'common.closeEsc': 'Close (Esc)',
  'common.viewFullscreen': 'View fullscreen',
  'editor.bold': 'Bold',
  'editor.italic': 'Italic',
  'editor.strikethrough': 'Strikethrough',
  'editor.code': 'Inline code',
  'editor.math': 'Math',
  'editor.codeLanguage': 'Language',
  'editor.noLanguagesFound': 'No languages found',
  'editor.searchLanguages': 'Search languages',
  'overlay.mermaidDiagram': 'Mermaid diagram',
  'overlay.zoomIn': 'Zoom in',
  'overlay.zoomOut': 'Zoom out',
  'overlay.zoomToFit': 'Zoom to fit',
  'overlay.zoomReset': 'Reset zoom',
  'overlay.zoomPresets': 'Zoom presets',
  'overlay.preview': 'Preview',
  'overlay.code': 'Code',
}

export function useTranslation() {
  const t = useCallback(
    (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? dict[key] ?? key,
    []
  )
  return { t, i18n: { language: 'en' } }
}

export default { useTranslation }
