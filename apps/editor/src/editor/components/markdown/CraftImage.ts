import { mergeAttributes } from '@tiptap/core'
import Image from '@tiptap/extension-image'

/**
 * Resolve a markdown image src for the DOM:
 * - http(s):// and data: URLs pass through
 * - anything else (workspace-relative or absolute path) is served by the
 *   file server via /api/assets
 */
export function resolveImageSrc(src: string): string {
  if (/^(https?:|data:)/i.test(src)) return src
  return `/api/assets?path=${encodeURIComponent(src)}`
}

/**
 * Image extension that renders workspace-relative markdown image sources
 * (`![](images/foo.png)`) through the file server (/api/assets) while keeping
 * the original relative path in the markdown serialization.
 */
export const CraftImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    const attrs = { ...HTMLAttributes }
    if (attrs.src) {
      attrs.src = resolveImageSrc(String(attrs.src))
    }
    return ['img', mergeAttributes(this.options.HTMLAttributes, attrs)]
  },
})
