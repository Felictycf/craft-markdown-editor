import { Extension } from '@tiptap/core'

/**
 * Ensures Tab / Shift-Tab navigate between table cells.
 * (The built-in shortcuts on the Table extension can lose priority
 * conflicts, so this re-registers them explicitly.)
 */
export const TableKeymap = Extension.create({
  name: 'tableKeymap',

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (!this.editor.isActive('table')) return false
        if (this.editor.commands.goToNextCell()) return true
        return this.editor.chain().addRowAfter().goToNextCell().run()
      },
      'Shift-Tab': () => {
        if (!this.editor.isActive('table')) return false
        return this.editor.commands.goToPreviousCell()
      },
    }
  },
})
