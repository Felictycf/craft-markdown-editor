import React, { useCallback, useImperativeHandle, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorView, keymap } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/**
 * Raw markdown source editor with syntax highlighting (CodeMirror).
 */

// Base editor chrome — transparent background so the app theme shows through.
const baseTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--foreground-90)',
    fontSize: '13.5px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': {
    fontFamily: 'var(--font-mono)',
    caretColor: 'var(--foreground)',
    padding: '0',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--foreground)',
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklch, var(--accent) 28%, transparent)',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-lineNumbers': { color: 'var(--foreground-30)' },
  '.cm-placeholder': { color: 'var(--foreground-30)' },
})

// Markdown token colors, derived from the app theme variables so they adapt
// to light/dark automatically.
const markdownHighlight = HighlightStyle.define([
  { tag: [t.heading1, t.heading2, t.heading3], color: 'var(--foreground)', fontWeight: '700' },
  { tag: t.heading, color: 'var(--foreground-80)', fontWeight: '600' },
  { tag: t.strong, color: 'var(--foreground)', fontWeight: '700' },
  { tag: t.emphasis, color: 'var(--foreground-70)', fontStyle: 'italic' },
  { tag: [t.link, t.url], color: 'var(--accent)', textDecoration: 'underline' },
  { tag: t.quote, color: 'var(--foreground-50)', fontStyle: 'italic' },
  { tag: t.monospace, color: 'var(--accent)' },
  { tag: t.list, color: 'var(--foreground-50)' },
  { tag: t.contentSeparator, color: 'var(--foreground-40)' },
  { tag: t.comment, color: 'var(--foreground-40)' },
  { tag: t.meta, color: 'var(--foreground-40)' },
  { tag: t.labelName, color: 'var(--foreground-60)' },
  { tag: t.invalid, color: 'var(--destructive)' },
])

export interface SourceEditorHandle {
  /** Scroll to a 1-based source line and focus the editor */
  scrollToLine: (line: number) => void
}

export const SourceEditor = React.forwardRef<
  SourceEditorHandle,
  {
    value: string
    onChange: (md: string) => void
    onTabIntoWysiwyg: () => void
  }
>(function SourceEditor({ value, onChange, onTabIntoWysiwyg }, ref) {
  const viewRef = useRef<EditorView | null>(null)

  useImperativeHandle(ref, () => ({
    scrollToLine: (line) => {
      const view = viewRef.current
      if (!view || view.state.doc.lines < line) return
      const pos = view.state.doc.line(line).from
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 24 }),
      })
      view.focus()
    },
  }), [])

  const handleChange = useCallback(
    (val: string) => {
      onChange(val)
    },
    [onChange]
  )

  return (
    <CodeMirror
      value={value}
      onChange={handleChange}
      onCreateEditor={(view) => {
        viewRef.current = view
      }}
      height="100%"
      placeholder="Markdown source…"
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        autocompletion: false,
        bracketMatching: true,
        closeBrackets: false,
        indentOnInput: true,
      }}
      extensions={[
        markdown({ base: markdownLanguage }),
        EditorView.lineWrapping,
        syntaxHighlighting(markdownHighlight),
        baseTheme,
        // Tab inserts two spaces; Cmd/Ctrl+E jumps back to the editor
        keymap.of([
          {
            key: 'Tab',
            run: (view: EditorView) => {
              view.dispatch(view.state.replaceSelection('  '))
              return true
            },
          },
          {
            key: 'Mod-e',
            run: () => {
              onTabIntoWysiwyg()
              return true
            },
          },
        ]),
      ]}
    />
  )
})
