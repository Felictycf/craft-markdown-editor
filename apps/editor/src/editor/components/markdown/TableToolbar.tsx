import * as React from 'react'
import type { Editor } from '@tiptap/react'
import {
  Columns3,
  Delete,
  Plus,
  Rows3,
  Trash2,
} from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * Floating toolbar shown while the cursor is inside a table.
 * Provides: insert row above/below, insert column left/right,
 * delete row/column, delete table.
 */

interface TableToolbarProps {
  editor: Editor
}

function isInsideTable(editor: Editor): boolean {
  return editor.isActive('table')
}

export function TableToolbar({ editor }: TableToolbarProps) {
  const [visible, setVisible] = React.useState(false)
  const [position, setPosition] = React.useState<{ top: number; left: number } | null>(null)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!editor) return

    const update = () => {
      if (!isInsideTable(editor)) {
        setVisible(false)
        return
      }

      const { from } = editor.state.selection
      try {
        const coords = editor.view.coordsAtPos(from)
        setPosition({
          top: coords.bottom + 6,
          left: coords.left,
        })
        setVisible(true)
      } catch {
        setVisible(false)
      }
    }

    update()
    editor.on('selectionUpdate', update)
    editor.on('transaction', update)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('transaction', update)
    }
  }, [editor])

  if (!visible || !position) return null

  const run = (fn: () => boolean) => {
    editor.chain().focus().run()
    fn()
  }

  return (
    <div
      ref={ref}
      className="tiptap-table-toolbar"
      style={{ top: position.top, left: position.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <ToolbarBtn title="Insert row above" onClick={() => run(() => editor.chain().addRowBefore().run())}>
        <Plus className="w-3.5 h-3.5" />
        <Rows3 className="w-3.5 h-3.5 rotate-180" />
      </ToolbarBtn>
      <ToolbarBtn title="Insert row below" onClick={() => run(() => editor.chain().addRowAfter().run())}>
        <Plus className="w-3.5 h-3.5" />
        <Rows3 className="w-3.5 h-3.5" />
      </ToolbarBtn>
      <ToolbarBtn title="Insert column left" onClick={() => run(() => editor.chain().addColumnBefore().run())}>
        <Plus className="w-3.5 h-3.5" />
        <Columns3 className="w-3.5 h-3.5 rotate-90" />
      </ToolbarBtn>
      <ToolbarBtn title="Insert column right" onClick={() => run(() => editor.chain().addColumnAfter().run())}>
        <Plus className="w-3.5 h-3.5" />
        <Columns3 className="w-3.5 h-3.5 -rotate-90" />
      </ToolbarBtn>

      <span className="tiptap-table-toolbar-sep" />

      <ToolbarBtn title="Delete row" onClick={() => run(() => editor.chain().deleteRow().run())}>
        <Delete className="w-3.5 h-3.5" />
        <Rows3 className="w-3.5 h-3.5" />
      </ToolbarBtn>
      <ToolbarBtn title="Delete column" onClick={() => run(() => editor.chain().deleteColumn().run())}>
        <Delete className="w-3.5 h-3.5" />
        <Columns3 className="w-3.5 h-3.5 rotate-90" />
      </ToolbarBtn>

      <span className="tiptap-table-toolbar-sep" />

      <ToolbarBtn title="Delete table" danger onClick={() => run(() => editor.chain().deleteTable().run())}>
        <Trash2 className="w-3.5 h-3.5" />
      </ToolbarBtn>
    </div>
  )
}

function ToolbarBtn({
  title,
  onClick,
  children,
  danger,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn('tiptap-table-toolbar-btn', danger && 'is-danger')}
    >
      {children}
    </button>
  )
}
