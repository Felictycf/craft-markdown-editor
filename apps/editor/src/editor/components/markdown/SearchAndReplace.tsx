import * as React from 'react'
import type { Editor } from '@tiptap/react'
import { Decoration, DecorationSet, type Decoration as DecorationType } from '@tiptap/pm/view'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { ChevronDown, ChevronUp, Replace, X } from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * Cmd+F find & replace inside the current document.
 * Highlights all matches via ProseMirror decorations; the current match is
 * selected/scrolled into view. Replace / Replace All operate on the doc.
 *
 * Design notes:
 * - Matches live in a ref (not state) so typing never re-registers the
 *   plugin (which would loop: register → transaction → recompute → register).
 * - The plugin is registered once per query; it reads the ref on each
 *   decoration pass, and we dispatch an empty transaction to force a redraw
 *   when the match set changes.
 */

interface Match {
  from: number
  to: number
}

const searchPluginKey = new PluginKey('craftSearch')

function collectMatches(doc: any, needle: string, caseSensitive: boolean): Match[] {
  if (!needle) return []
  const matches: Match[] = []
  const lower = caseSensitive ? needle : needle.toLowerCase()
  doc.descendants((node: any, pos: number) => {
    if (!node.isText) return true
    const text = caseSensitive ? node.text : node.text.toLowerCase()
    let idx = text.indexOf(lower)
    while (idx !== -1) {
      matches.push({ from: pos + idx, to: pos + idx + lower.length })
      idx = text.indexOf(lower, idx + 1)
    }
    return true
  })
  return matches
}

export function SearchAndReplace({ editor, initialText }: { editor: Editor; initialText?: string }) {
  const [open, setOpen] = React.useState(false)
  const [findText, setFindText] = React.useState('')
  const [replaceText, setReplaceText] = React.useState('')
  const [caseSensitive, setCaseSensitive] = React.useState(false)
  const [, setVersion] = React.useState(0)

  const matchesRef = React.useRef<Match[]>([])
  const currentRef = React.useRef(0)
  const findRef = React.useRef<HTMLInputElement>(null)

  const bump = React.useCallback(() => setVersion((v) => v + 1), [])

  const recompute = React.useCallback(() => {
    const ms = collectMatches(editor.state.doc, findText, caseSensitive)
    const prev = matchesRef.current
    const changed =
      ms.length !== prev.length ||
      ms.some((m, i) => m.from !== prev[i]?.from || m.to !== prev[i]?.to)
    matchesRef.current = ms
    if (currentRef.current >= ms.length) currentRef.current = Math.max(0, ms.length - 1)
    if (changed) {
      bump()
      // Force ProseMirror to re-run decorations with the new match set.
      editor.view.dispatch(editor.state.tr.setMeta(searchPluginKey, { refresh: true }))
    }
  }, [editor, findText, caseSensitive, bump])

  // Recomputed on doc changes while open
  React.useEffect(() => {
    if (!open) return
    recompute()
    editor.on('transaction', recompute)
    return () => {
      editor.off('transaction', recompute)
    }
  }, [open, findText, caseSensitive, editor, recompute])

  // Decoration plugin — registered once per query, reads matches from the ref
  React.useEffect(() => {
    if (!open || !findText) return
    const plugin = new Plugin({
      key: searchPluginKey,
      props: {
        decorations(state) {
          const ms = matchesRef.current
          if (ms.length === 0) return DecorationSet.empty
          const decos: DecorationType[] = []
          ms.forEach((m, i) => {
            decos.push(
              Decoration.inline(m.from, m.to, {
                class: i === currentRef.current ? 'search-match-current' : 'search-match',
              })
            )
          })
          return DecorationSet.create(state.doc, decos)
        },
      },
    })
    editor.registerPlugin(plugin)
    return () => {
      editor.unregisterPlugin(searchPluginKey)
    }
  }, [open, findText, editor])

  // Cmd/Ctrl+F toggles
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f' && !e.shiftKey) {
        e.preventDefault()
        setOpen((o) => !o)
        setTimeout(() => findRef.current?.focus(), 50)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Open with a preset query (global search "open result" flow)
  React.useEffect(() => {
    if (initialText) {
      setFindText(initialText)
      setOpen(true)
      setTimeout(() => findRef.current?.focus(), 50)
    }
  }, [initialText])

  const matches = matchesRef.current
  const current = currentRef.current
  const matchLabel = matches.length > 0 ? `${current + 1}/${matches.length}` : '0/0'

  const goTo = React.useCallback(
    (index: number) => {
      const ms = matchesRef.current
      if (ms.length === 0) return
      const i = ((index % ms.length) + ms.length) % ms.length
      const m = ms[i]
      currentRef.current = i
      bump()
      const tr = editor.state.tr
        .setSelection(TextSelection.create(editor.state.doc, m.from, m.to))
        .scrollIntoView()
      editor.view.dispatch(tr)
      editor.view.focus()
    },
    [editor, bump]
  )

  const replaceCurrent = React.useCallback(() => {
    const ms = matchesRef.current
    const m = ms[currentRef.current]
    if (!m) return
    const tr = editor.state.tr.replaceWith(m.from, m.to, editor.state.schema.text(replaceText))
    editor.view.dispatch(tr)
    // recompute happens via the transaction listener
  }, [editor, replaceText])

  const replaceAll = React.useCallback(() => {
    const ms = matchesRef.current
    if (ms.length === 0) return
    let tr = editor.state.tr
    for (let i = ms.length - 1; i >= 0; i--) {
      tr = tr.replaceWith(ms[i].from, ms[i].to, editor.state.schema.text(replaceText))
    }
    editor.view.dispatch(tr)
  }, [editor, replaceText])

  if (!open) return null

  return (
    <div className="craft-search-bar" onMouseDown={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1.5">
        <input
          ref={findRef}
          value={findText}
          onChange={(e) => setFindText(e.target.value)}
          placeholder="Find…"
          className="craft-search-input w-44"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              goTo(e.shiftKey ? current - 1 : current + 1)
            }
            if (e.key === 'Escape') setOpen(false)
          }}
        />
        <span className="craft-search-count">{matchLabel}</span>
        <button className="craft-search-btn" title="Previous (Shift+Enter)" onClick={() => goTo(current - 1)}>
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
        <button className="craft-search-btn" title="Next (Enter)" onClick={() => goTo(current + 1)}>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
        <button
          className={cn('craft-search-btn', caseSensitive && 'is-active')}
          title="Match case"
          onClick={() => setCaseSensitive((c) => !c)}
        >
          Aa
        </button>
        <button className="craft-search-btn" title="Close (Esc)" onClick={() => setOpen(false)}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-1.5 mt-1.5">
        <input
          value={replaceText}
          onChange={(e) => setReplaceText(e.target.value)}
          placeholder="Replace…"
          className="craft-search-input w-44"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              replaceCurrent()
            }
            if (e.key === 'Escape') setOpen(false)
          }}
        />
        <button
          className="craft-search-btn"
          title="Replace current (Enter)"
          disabled={!matches.length}
          onClick={replaceCurrent}
        >
          <Replace className="w-3.5 h-3.5" />
        </button>
        <button
          className="craft-search-btn"
          title="Replace all"
          disabled={!matches.length}
          onClick={replaceAll}
        >
          All
        </button>
      </div>
    </div>
  )
}
