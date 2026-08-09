import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * Temporary "flash" highlight for the heading a user jumped to from the
 * document outline. Rendered as a ProseMirror node decoration — the only
 * safe way to set classes on editor DOM (external classList mutations get
 * reverted by ProseMirror's DOM observer).
 */

export interface TocFlashMeta {
  /** Node position of the heading to highlight */
  pos?: number
  /** Dispatch `{ clear: true }` to remove the highlight */
  clear?: boolean
}

export const tocFlashPluginKey = new PluginKey<TocFlashMeta>('tocFlash')

export const TocFlash = Extension.create({
  name: 'tocFlash',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: tocFlashPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => {
            const meta = tr.getMeta(tocFlashPluginKey)
            if (meta) {
              if (meta.clear) return DecorationSet.empty
              if (typeof meta.pos !== 'number') return set
              // Inline decoration over the heading's text range: classes on
              // block elements get reverted by ProseMirror's DOM observer
              // (attribute mutations on node descs trigger a rebuild), while
              // inline spans are ignored by the observer.
              const node = tr.doc.nodeAt(meta.pos)
              if (!node || !node.isTextblock) return set
              const from = meta.pos + 1
              const to = meta.pos + node.nodeSize - 1
              const deco = Decoration.inline(from, to, { class: 'toc-flash' })
              return DecorationSet.create(tr.doc, [deco])
            }
            return set.map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations(state) {
            return tocFlashPluginKey.getState(state) as DecorationSet
          },
        },
      }),
    ]
  },
})
