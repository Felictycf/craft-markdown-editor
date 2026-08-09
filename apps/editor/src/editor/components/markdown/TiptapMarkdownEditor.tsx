import * as React from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from './extensions/AnimatedTaskItem'
import { Mathematics } from '@tiptap/extension-mathematics'
import Image from '@tiptap/extension-image'
import FileHandler from '@tiptap/extension-file-handler'
import { Markdown as OfficialMarkdown } from '@tiptap/markdown'
import { Markdown as LegacyMarkdown } from 'tiptap-markdown'
import { tiptapCodeBlock } from './TiptapCodeBlockView'
import { TiptapBubbleMenus, INLINE_MATH_EDIT_EVENT } from './TiptapBubbleMenus'
import { TiptapSlashMenu } from './TiptapSlashMenu'
import { MermaidBlock } from './extensions/MermaidBlock'
import { looksLikeMermaidSource } from './mermaid-source'
import { LatexBlock } from './extensions/LatexBlock'
import { RichBlockInteractions } from './extensions/RichBlockInteractions'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { TableToolbar } from './TableToolbar'
import { TableKeymap } from './TableKeymap'
import { cn } from '../../lib/utils'
import 'katex/dist/katex.min.css'
import './tiptap-editor.css'
import './extensions/animated-task-item.css'

export type MarkdownEngine = 'legacy' | 'official'


function getLegacyMarkdown(editor: { storage: { markdown?: { getMarkdown?: () => string } } }): string {
  return editor.storage.markdown?.getMarkdown?.() ?? ''
}

function getOfficialMarkdown(editor: { getMarkdown?: () => string }): string {
  return editor.getMarkdown?.() ?? ''
}

function forceShikiDecorations(editor: any) {
  try {
    if (editor?.isDestroyed) return
    const tr = editor.view?.state.tr.setMeta('shikiPluginForceDecoration', true)
    if (tr) {
      editor.view?.dispatch(tr)
    }
  } catch {
    // Best-effort refresh only.
  }
}

function scheduleShikiRefresh(editor: any) {
  forceShikiDecorations(editor)

  for (const delay of [80, 220, 450]) {
    setTimeout(() => {
      forceShikiDecorations(editor)
    }, delay)
  }
}

const INLINE_DOUBLE_DOLLAR_REGEX = /\$\$([^\n]+?)\$\$/g
// Currency marker used during official parse to avoid accidental math tokenization.
const CURRENCY_MARKER = '¤'
const CURRENCY_RANGE_REGEX = /\$(\d[\dA-Za-z.,]*\s*[–-]\s*)\$(\d[\dA-Za-z.,]*)/g
const CURRENCY_AMOUNT_REGEX = /\$(\d[\dA-Za-z.,]*)/g

/**
 * Normalize markdown for official TipTap parser:
 * - Keep product policy: users write math with $$...$$
 * - Convert same-line $$...$$ to inline $...$ (TipTap inline math)
 * - Escape currency-like dollars ($100, $2M...) so they don't become inline math nodes
 */
export function preprocessMarkdownForOfficial(markdown: string): string {
  let index = 0
  const placeholders = new Map<string, string>()

  const withPlaceholders = markdown.replace(INLINE_DOUBLE_DOLLAR_REGEX, (_, latex: string) => {
    const key = `@@CA_INLINE_MATH_${index++}@@`
    placeholders.set(key, latex)
    return key
  })

  const rangeProtected = withPlaceholders.replace(
    CURRENCY_RANGE_REGEX,
    (_match, left: string, right: string) => `${CURRENCY_MARKER}${left}${CURRENCY_MARKER}${right}`
  )

  const amountProtected = rangeProtected.replace(
    CURRENCY_AMOUNT_REGEX,
    (_match, amount: string) => `${CURRENCY_MARKER}${amount}`
  )

  return amountProtected.replace(/@@CA_INLINE_MATH_\d+@@/g, (key) => {
    const latex = placeholders.get(key) ?? ''
    return `$${latex}$`
  })
}

/** Undo parser-safety escaping in serialized markdown. */
export function postprocessMarkdownFromOfficial(markdown: string): string {
  return markdown.replaceAll(CURRENCY_MARKER, '$')
}

const MERMAID_FILE_EXTENSIONS = new Set(['mmd', 'mermaid'])

export function isMermaidFilename(fileName: string): boolean {
  const ext = fileName.toLowerCase().split('.').pop()
  return ext != null && MERMAID_FILE_EXTENSIONS.has(ext)
}

export function extractMermaidSource(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const fenced = trimmed.match(/^```mermaid\s*\n([\s\S]*?)\n```$/i)
  if (fenced?.[1]) {
    const source = fenced[1].trim()
    return source.length > 0 ? source : null
  }

  return looksLikeMermaidSource(trimmed) ? trimmed : null
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') resolve(result)
      else reject(new Error('Failed to read file as data URL'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

async function readImageDimensions(src: string): Promise<{ width: number; height: number } | null> {
  return await new Promise((resolve) => {
    const image = new globalThis.Image()
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        resolve(null)
        return
      }
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => resolve(null)
    image.src = src
  })
}

function insertMermaidBlock(editor: NonNullable<ReturnType<typeof useEditor>>, source: string, pos?: number) {
  const payload = {
    type: 'mermaidBlock',
    attrs: { code: source },
  }

  const chain = editor.chain().focus()
  if (typeof pos === 'number') chain.setTextSelection(pos)
  chain.insertContent(payload).run()
}

function insertImageNode(
  editor: NonNullable<ReturnType<typeof useEditor>>,
  src: string,
  pos?: number,
  dimensions?: { width: number; height: number } | null,
) {
  const chain = editor.chain().focus()
  if (typeof pos === 'number') chain.setTextSelection(pos)
  chain.setImage({
    src,
    ...(dimensions?.width && dimensions?.height
      ? { width: dimensions.width, height: dimensions.height }
      : {}),
  }).run()
}

/**
 * Detect GFM table syntax in pasted text: a line containing `|` followed by
 * a separator line of dashes/pipes/colons.
 */
function detectMarkdownTable(text: string): boolean {
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].includes('|')) continue
    const sep = lines[i + 1]
    if (sep.includes('-') && /^\s*\|?[\s|: -]+\|?\s*$/.test(sep)) return true
  }
  return false
}

/**
 * Convert an HTML <table> (e.g. copied from another app) into a GFM table
 * string so it goes through the markdown parser (the raw HTML table path
 * corrupts thead/tbody structure in TipTap).
 */
function htmlTableToMarkdown(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const table = doc.querySelector('table')
  if (!table) return null
  const rows = table.querySelectorAll('tr')
  if (rows.length === 0) return null

  const grid: string[][] = []
  let maxCols = 0
  rows.forEach((tr) => {
    const cells = Array.from(tr.querySelectorAll('th, td')).map((c) => (c.textContent ?? '').trim())
    grid.push(cells)
    maxCols = Math.max(maxCols, cells.length)
  })

  const line = (row: string[]) =>
    `| ${row.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`
  const padded = grid.map((row) => {
    const r = [...row]
    while (r.length < maxCols) r.push('')
    return r
  })
  const sep = `| ${Array(maxCols).fill('---').join(' | ')} |`
  return [line(padded[0]), sep, ...padded.slice(1).map(line)].join('\n')
}

async function handleDroppedOrPastedFiles(
  editor: NonNullable<ReturnType<typeof useEditor>>,
  files: File[],
  pos?: number,
): Promise<void> {
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      const src = await readFileAsDataUrl(file)
      const dimensions = await readImageDimensions(src)
      insertImageNode(editor, src, pos, dimensions)
      continue
    }

    if (!isMermaidFilename(file.name)) continue
    const text = await file.text()
    const source = extractMermaidSource(text) ?? text.trim()
    if (!source) continue
    insertMermaidBlock(editor, source, pos)
  }
}

export interface TiptapMarkdownEditorProps {
  /** Markdown string content */
  content: string
  /** Called when content changes */
  onUpdate?: (markdown: string) => void
  /** Placeholder text when empty */
  placeholder?: string
  className?: string
  /** Whether the editor is editable */
  editable?: boolean
  /**
   * Markdown engine.
   * - `official`: @tiptap/markdown + mathematics extension (default) — live
   *   KaTeX rendering, custom block (mermaid/latex) round-trips
   * - `legacy`: tiptap-markdown (kept for reference)
   */
  markdownEngine?: MarkdownEngine
}

export function TiptapMarkdownEditor({
  content,
  onUpdate,
  placeholder = 'Write something...',
  className,
  editable = true,
  markdownEngine = 'official',
}: TiptapMarkdownEditorProps) {
  const onUpdateRef = React.useRef(onUpdate)
  onUpdateRef.current = onUpdate

  // Ref for the editor instance — used by the Mathematics onClick callback
  // which is created at extension-configure time (before useEditor returns).
  const editorRef = React.useRef<ReturnType<typeof useEditor>>(null!)

  const useOfficialMarkdown = markdownEngine === 'official'

  const extensions = React.useMemo(() => {
    const base = [
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [1, 2, 3] },
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      // Mermaid/latex blocks must be registered BEFORE tiptapCodeBlock:
      // the markdown engine dispatches the `code` token to the first
      // handler that accepts it, and tiptapCodeBlock would otherwise claim
      // every fenced block.
      MermaidBlock,
      LatexBlock,
      tiptapCodeBlock.configure({
        themes: { light: 'github-light', dark: 'github-dark' },
      }),
      Placeholder.configure({ placeholder }),
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      FileHandler.configure({
        onPaste: async (editor, files) => {
          if (!editable || files.length === 0) return
          await handleDroppedOrPastedFiles(editor as NonNullable<ReturnType<typeof useEditor>>, files)
        },
        onDrop: async (editor, files, pos) => {
          if (!editable || files.length === 0) return
          await handleDroppedOrPastedFiles(editor as NonNullable<ReturnType<typeof useEditor>>, files, pos)
        },
      }),
      RichBlockInteractions,
      Table.configure({
        resizable: true,
        HTMLAttributes: { class: 'tiptap-table' },
      }),
      TableRow,
      TableHeader,
      TableCell,
      TableKeymap,
      ...(editable ? [TiptapSlashMenu] : []),
    ]

    if (useOfficialMarkdown) {
      return [
        ...base,
        Mathematics.configure({
          inlineOptions: {
            onClick: (_node, pos) => {
              const e = editorRef.current
              if (!e) return
              e.chain().focus().setNodeSelection(pos).run()
              // Emit after selection so BubbleMenu mounts, then the event activates the input
              queueMicrotask(() => (e as any).emit(INLINE_MATH_EDIT_EVENT))
            },
          },
          katexOptions: {
            throwOnError: false,
            strict: false,
          },
        }),
        OfficialMarkdown.configure({
          markedOptions: {
            gfm: true,
            // Autolink bare URLs (e.g. URLs inside table cells) so they
            // render as clickable links like the Craft Agents datatable.
            linkify: true,
          } as never,
        }),
      ]
    }

    return [
      ...base,
      LegacyMarkdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ]
  }, [placeholder, useOfficialMarkdown])

  const initialContent = useOfficialMarkdown
    ? preprocessMarkdownForOfficial(content)
    : content

  const editor = useEditor({
    extensions,
    content: initialContent,
    ...(useOfficialMarkdown ? { contentType: 'markdown' as const } : {}),
    editable,
    editorProps: {
      attributes: {
        class: 'tiptap-prose outline-none',
      },
      // Open links in the default browser (web: window.open;
      // Electron: routed to shell.openExternal by the window open handler).
      handleClick: (_view, _pos, event) => {
        const anchor = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a')
        if (anchor?.href && editable) {
          event.preventDefault()
          window.open(anchor.href, '_blank', 'noopener')
          return true
        }
        return false
      },
      handlePaste: (_view, event) => {
        if (!editable) return false
        if (event.clipboardData?.files?.length) return false

        const activeEditor = editorRef.current
        if (!activeEditor) return false

        // Inside a code block: keep the default behavior so pasted text lands
        // verbatim in the code block (markdown-parse insert would otherwise
        // spill the content OUTSIDE the code block).
        if (activeEditor.isActive('codeBlock')) return false

        const text = event.clipboardData?.getData('text/plain') ?? ''
        const source = extractMermaidSource(text)
        if (source) {
          insertMermaidBlock(activeEditor, source)
          return true
        }

        // Plain-text clipboard (no HTML): parse the pasted text as markdown so
        // headings, bold, lists, quotes and code fences render immediately.
        const hasHtml = event.clipboardData?.types?.includes('text/html') ?? false
        let markdownInsert: string | null = null
        if (text.length > 0 && (!hasHtml || detectMarkdownTable(text))) {
          markdownInsert = text
        } else if (hasHtml && text.length === 0) {
          // HTML-only clipboard containing a table: convert to GFM first —
          // the raw HTML table path corrupts thead/tbody structure.
          const html = event.clipboardData?.getData('text/html') ?? ''
          if (html.includes('<table')) {
            markdownInsert = htmlTableToMarkdown(html)
          }
        }

        if (markdownInsert != null) {
          const { state } = activeEditor
          const { from, to } = state.selection
          // Block-level content (tables, code fences, …) pasted into an empty
          // paragraph would be nested INSIDE the paragraph. Replace the whole
          // empty paragraph instead so blocks land at top level.
          if (to === from && state.doc.resolve(from).parent.textContent.trim().length === 0) {
            const $from = state.doc.resolve(from)
            activeEditor.commands.insertContentAt(
              { from: $from.before(), to: $from.after() },
              markdownInsert,
              { contentType: 'markdown' } as never
            )
          } else {
            activeEditor.commands.insertContentAt(
              { from, to },
              markdownInsert,
              { contentType: 'markdown' } as never
            )
          }
          return true
        }

        return false
      },
      handleDrop: (view, event) => {
        if (!editable) return false
        if (event.dataTransfer?.files?.length) return false

        const text = event.dataTransfer?.getData('text/plain') ?? ''
        const source = extractMermaidSource(text)
        if (!source) return false

        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        const activeEditor = editorRef.current
        if (!activeEditor) return false
        insertMermaidBlock(activeEditor, source, pos)
        return true
      },
    },
    onCreate: ({ editor }) => {
      queueMicrotask(() => {
        scheduleShikiRefresh(editor)
      })
    },
    onUpdate: ({ editor }) => {
      const md = useOfficialMarkdown
        ? postprocessMarkdownFromOfficial(getOfficialMarkdown(editor as { getMarkdown?: () => string }))
        : getLegacyMarkdown(editor as { storage: { markdown?: { getMarkdown?: () => string } } })
      onUpdateRef.current?.(md)
    },
  }, [useOfficialMarkdown, extensions])

  // Keep editorRef in sync for the Mathematics onClick callback
  editorRef.current = editor


  // Sync editable prop
  React.useEffect(() => {
    if (editor && editor.isEditable !== editable) {
      editor.setEditable(editable)
    }
  }, [editor, editable])

  // Sync content when the selected task changes (key prop handles this,
  // but as a safety net for direct content prop changes)
  const prevContentRef = React.useRef(content)

  // Loop guard: some markdown round-trips are not byte-identical (e.g. table
  // column padding), so setContent → onUpdate → serialize → setContent can
  // oscillate. Once the content bounces too often in a short window, trust
  // the editor's own state instead of force-resyncing it.
  const syncGuardRef = React.useRef({ count: 0, windowStart: 0 })
  React.useEffect(() => {
    if (editor && content !== prevContentRef.current) {
      prevContentRef.current = content

      // Important: when this editor is currently focused, treat incoming content as
      // local controlled echo and avoid setContent resets that can collapse transient
      // block states (e.g. slash-inserted code blocks) and jump selection.
      if (editor.isFocused) return

      const now = Date.now()
      if (now - syncGuardRef.current.windowStart > 1000) {
        syncGuardRef.current = { count: 0, windowStart: now }
      }
      if (++syncGuardRef.current.count > 3) return

      const currentMd = useOfficialMarkdown
        ? postprocessMarkdownFromOfficial(getOfficialMarkdown(editor as { getMarkdown?: () => string }))
        : getLegacyMarkdown(editor as { storage: { markdown?: { getMarkdown?: () => string } } })

      if (currentMd !== content) {
        if (useOfficialMarkdown) {
          const normalized = preprocessMarkdownForOfficial(content)
          editor.commands.setContent(normalized, { contentType: 'markdown' } as never)
        } else {
          editor.commands.setContent(content)
        }

        queueMicrotask(() => {
          if (!editor.isDestroyed) {
            scheduleShikiRefresh(editor)
          }
        })
      }
    }
  }, [editor, content, useOfficialMarkdown])

  return (
    <div className={cn('tiptap-editor', className)}>
      <EditorContent editor={editor} />
      {editor && editable && <TiptapBubbleMenus editor={editor} />}
      {editor && editable && <TableToolbar editor={editor} />}
    </div>
  )
}
