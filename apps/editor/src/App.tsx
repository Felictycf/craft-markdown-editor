import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  Code2,
  Eye,
  ListTree,
  Search,
  FilePlus2,
  FolderPlus,
  FolderOpen,
  Moon,
  PanelLeft,
  RefreshCw,
  Sun,
  X,
} from 'lucide-react'
import { FileTree } from './components/FileTree'
import { SourceEditor } from './components/SourceEditor'
import { GlobalSearch } from './components/GlobalSearch'
import { Dialog } from './components/Dialog'
import { DocumentOutline } from './components/DocumentOutline'
import { extractOutline } from './components/outline'
import type { OutlineHeading } from './components/outline'
import { TiptapMarkdownEditor } from './editor/components/markdown/TiptapMarkdownEditor'
import type { TiptapMarkdownEditorHandle } from './editor/components/markdown/TiptapMarkdownEditor'
import type { SourceEditorHandle } from './components/SourceEditor'
import { PlatformProvider } from './editor/context/PlatformContext'
import { ShikiThemeProvider } from './editor/context/ShikiThemeContext'
import * as api from './api'
import type { TreeNode } from './api'
import { cn } from './editor/lib/utils'

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
type ViewMode = 'wysiwyg' | 'source'

const SAVE_DELAY_MS = 700
const LAST_FILE_KEY = 'craft-editor.lastFile'

/**
 * The TipTap markdown engines serialize freshly-created task items as
 * `- \[ \] ...` (escaped brackets). Normalize back to standard task syntax
 * so files stay compatible with other markdown tools.
 */
function normalizeMarkdown(md: string): string {
  // TipTap serializes task items as `- \[ \] ...` (escaped brackets), including
  // nested list markers (`- - \[ \] ...`). Normalize back to standard task syntax.
  return md.replace(/^(\s*(?:[-*+]|\d+\.)[ \t]+)*\\\[ \\\]/gm, (match, prefix: string) => `${prefix ?? ''}[ ]`)
}

export default function App() {
  const [workspace, setWorkspace] = useState<api.WorkspaceInfo | null>(null)
  const [tree, setTree] = useState<TreeNode[]>([])

  // --- multi-tab editing state -------------------------------------------
  interface Tab {
    path: string
    content: string
    saved: string
  }
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [activeHeading, setActiveHeading] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('wysiwyg')
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [pendingSearch, setPendingSearch] = useState('')
  const [dark, setDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)
  const [error, setError] = useState('')

  // Derived: the active tab drives the editor + status bar
  const activeTab = tabs.find((t) => t.path === activePath) ?? null
  const openFile = activeTab?.path ?? null
  const content = activeTab?.content ?? ''

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tabsRef = useRef<Tab[]>([])
  const activePathRef = useRef<string | null>(null)
  const mainRef = useRef<HTMLElement | null>(null)
  const editorRef = useRef<TiptapMarkdownEditorHandle | null>(null)
  const sourceRef = useRef<SourceEditorHandle | null>(null)
  tabsRef.current = tabs
  activePathRef.current = activePath

  // Document outline (TOC): headings of the active tab, recomputed on edit.
  const outline = useMemo(
    () => (openFile ? extractOutline(content) : []),
    [openFile, content]
  )

  // Active heading tracking: the last heading above the scroll offset in the
  // main column. Queries real DOM (WYSIWYG h1–h6 / CodeMirror .cm-line).
  const computeActiveHeading = useCallback(() => {
    const container = mainRef.current
    if (!container || !openFile) {
      setActiveHeading(null)
      return
    }
    const headY = 40
    const occByLevel: Record<number, number> = {}
    const candidates: Array<{ id: string; top: number }> = []

    const consider = (el: HTMLElement, level: number) => {
      const id = `${level}:${occByLevel[level] ?? 0}`
      occByLevel[level] = (occByLevel[level] ?? 0) + 1
      const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top
      if (top <= headY) candidates.push({ id, top })
    }

    if (viewModeRef.current === 'source') {
      container.querySelectorAll<HTMLElement>('.cm-line').forEach((el) => {
        const m = (el.textContent ?? '').match(/^\s*(#{1,6})\s+(.+)$/)
        if (m) consider(el, m[1].length)
      })
    } else {
      container
        .querySelectorAll<HTMLElement>('.tiptap-prose h1, .tiptap-prose h2, .tiptap-prose h3, .tiptap-prose h4, .tiptap-prose h5, .tiptap-prose h6')
        .forEach((el) => consider(el, parseInt(el.tagName[1], 10)))
    }

    let best: { id: string; top: number } | null = null
    for (const c of candidates) {
      if (best === null || c.top > best.top) best = c
    }
    setActiveHeading(best?.id ?? null)
  }, [openFile])

  const viewModeRef = useRef(viewMode)
  viewModeRef.current = viewMode

  // Recompute the active heading after renders that change layout/scroll
  // (file switch, view mode toggle, content updates, outline open/close).
  useEffect(() => {
    const raf = requestAnimationFrame(() => computeActiveHeading())
    return () => cancelAnimationFrame(raf)
  }, [computeActiveHeading, viewMode, outlineOpen, activePath, content])

  // Drop stale active ids when headings change (e.g. a heading was edited away).
  useEffect(() => {
    if (activeHeading && !outline.some((h) => h.id === activeHeading)) {
      setActiveHeading(null)
    }
  }, [outline, activeHeading])

  const handleOutlineNavigate = useCallback((h: OutlineHeading) => {
    setActiveHeading(h.id)
    if (viewModeRef.current === 'source') {
      sourceRef.current?.scrollToLine(h.line)
    } else {
      editorRef.current?.scrollToHeading({
        level: h.level,
        occurrence: h.occurrence,
        globalIndex: h.globalIndex,
      })
    }
  }, [])

  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const tab = tabsRef.current.find((t) => t.path === activePathRef.current)
    if (!tab) return
    if (tab.content === tab.saved) {
      setSaveState('saved')
      return
    }
    setSaveState('saving')
    try {
      await api.saveFile(tab.path, normalizeMarkdown(tab.content))
      setTabs((prev) => prev.map((t) => (t.path === tab.path ? { ...t, saved: t.content } : t)))
      setSaveState('saved')
    } catch (err) {
      setSaveState('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const scheduleSave = useCallback(() => {
    setSaveState('dirty')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void flushSave(), SAVE_DELAY_MS)
  }, [flushSave])

  // Theme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  // Keyboard shortcuts: Cmd/Ctrl+S, Cmd/Ctrl+Shift+F
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void flushSave()
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setGlobalSearchOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flushSave])

  const loadTree = useCallback(async () => {
    const nodes = await api.getTree()
    setTree(nodes)
    return nodes
  }, [])

  const initWorkspace = useCallback(async () => {
    try {
      const ws = await api.getWorkspace()
      if (!ws) return
      setWorkspace(ws)
      const nodes = await loadTree()
      // restore last opened file if it still exists
      const last = localStorage.getItem(LAST_FILE_KEY)
      if (last && findNode(nodes, last)?.type === 'file') {
        void openFileByPath(last)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [loadTree])

  useEffect(() => {
    void initWorkspace()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openFileByPath = useCallback(
    async (path: string) => {
      // Save any pending edits of the outgoing tab before switching.
      await flushSave()

      // Already open? Just activate the tab (keeps its unsaved content).
      if (tabsRef.current.some((t) => t.path === path)) {
        setActivePath(path)
        localStorage.setItem(LAST_FILE_KEY, path)
        setError('')
        return
      }
      try {
        const { content } = await api.getFile(path)
        setTabs((prev) => [...prev, { path, content, saved: content }])
        setActivePath(path)
        setSaveState('saved')
        setError('')
        localStorage.setItem(LAST_FILE_KEY, path)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [flushSave]
  )

  const closeTab = useCallback((path: string) => {
    void flushSave()
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === path)
      if (idx === -1) return prev
      const next = prev.filter((t) => t.path !== path)
      if (activePathRef.current === path) {
        const neighbor = next[idx] ?? next[idx - 1] ?? null
        setActivePath(neighbor ? neighbor.path : null)
        if (!neighbor) localStorage.removeItem(LAST_FILE_KEY)
      }
      return next
    })
  }, [])

  const openFolder = useCallback(async (root: string) => {
    try {
      const ws = await api.setWorkspace(root)
      setWorkspace(ws)
      setTabs([])
      setActivePath(null)
      setSaveState('idle')
      setError('')
      await loadTree()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [loadTree])

  const handleEditorUpdate = useCallback(
    (md: string) => {
      const path = activePathRef.current
      if (!path) return
      setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, content: md } : t)))
      scheduleSave()
    },
    [scheduleSave]
  )

  const createFile = useCallback(async (folder: string, name: string) => {
    const path = folder ? `${folder}/${name}` : name
    try {
      await api.createEntry(path, 'file')
      await loadTree()
      await openFileByPath(path)
      expandAncestors(path, (p) => setExpanded((prev) => new Set(prev).add(p)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [loadTree, openFileByPath])

  const createFolder = useCallback(async (folder: string, name: string) => {
    const path = folder ? `${folder}/${name}` : name
    try {
      await api.createEntry(path, 'folder')
      await loadTree()
      setExpanded((prev) => new Set(prev).add(path))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [loadTree])

  const renameEntry = useCallback(async (path: string, name: string) => {
    const to = path.includes('/') ? `${path.slice(0, path.lastIndexOf('/') + 1)}${name}` : name
    try {
      await api.renameEntry(path, to)
      // Keep tabs in sync (rename the matching tab's path)
      setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, path: to } : t)))
      if (activePathRef.current === path) {
        setActivePath(to)
        localStorage.setItem(LAST_FILE_KEY, to)
      }
      await loadTree()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [loadTree])

  const deleteEntry = useCallback(async (path: string) => {
    try {
      await api.deleteEntry(path)
      if (tabsRef.current.some((t) => t.path === path)) {
        closeTab(path)
      }
      await loadTree()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [loadTree, closeTab])

  const moveEntry = useCallback(
    async (
      from: string,
      toDir: string,
      opts?: { anchor?: string; before?: boolean }
    ) => {
      try {
        const { to } = await api.moveEntry(from, toDir, opts)
        // Keep tabs in sync: the moved entry (or its subtree) changes path
        setTabs((prev) =>
          prev.map((t) => {
            if (t.path === from) return { ...t, path: to }
            if (t.path.startsWith(from + '/')) return { ...t, path: to + t.path.slice(from.length) }
            return t
          })
        )
        const act = activePathRef.current
        if (act === from || (act && act.startsWith(from + '/'))) {
          const newAct = act === from ? to : to + act.slice(from.length)
          setActivePath(newAct)
          localStorage.setItem(LAST_FILE_KEY, newAct)
        }
        await loadTree()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [loadTree]
  )

  const toggleTheme = useCallback(() => setDark((d) => !d), [])

  // ---------------------------------------------------------------------------
  // Dialogs — window.prompt/confirm are disabled in the Electron app, so all
  // file operations go through a custom dialog.
  // ---------------------------------------------------------------------------

  type DialogState =
    | { type: 'newFile'; folder: string }
    | { type: 'newFolder'; folder: string }
    | { type: 'rename'; path: string; name: string }
    | { type: 'delete'; path: string }
    | { type: 'openFolder'; initial: string }

  const [dialog, setDialog] = useState<DialogState | null>(null)

  const dialogNode = dialog && (
    <Dialog
      title={
        dialog.type === 'newFile'
          ? 'New file'
          : dialog.type === 'newFolder'
            ? 'New folder'
            : dialog.type === 'rename'
              ? 'Rename'
              : dialog.type === 'delete'
                ? 'Delete'
                : 'Open folder'
      }
      description={
        dialog.type === 'delete'
          ? `"${dialog.path}" will be permanently deleted.`
          : dialog.type === 'newFile'
            ? dialog.folder
              ? `In ${dialog.folder}/`
              : 'In workspace root'
            : dialog.type === 'rename'
              ? dialog.path
              : dialog.type === 'openFolder'
                ? 'Absolute path of the folder to open as workspace'
                : undefined
      }
      initialValue={
        dialog.type === 'rename'
          ? dialog.name
          : dialog.type === 'openFolder'
            ? dialog.initial
            : dialog.type === 'newFile' || dialog.type === 'newFolder'
              ? ''
              : undefined
      }
      confirmLabel={
        dialog.type === 'delete' ? 'Delete' : dialog.type === 'openFolder' ? 'Open' : 'Create'
      }
      danger={dialog.type === 'delete'}
      browse={
        dialog.type === 'openFolder'
          ? () => window.craft?.openDirectoryDialog?.() ?? Promise.resolve(null)
          : undefined
      }
      onConfirm={(value) => {
        const d = dialog
        setDialog(null)
        if (d.type === 'newFile') {
          if (value) void createFile(d.folder, value)
        } else if (d.type === 'newFolder') {
          if (value) void createFolder(d.folder, value)
        } else if (d.type === 'rename') {
          if (value && value !== d.path.split('/').pop()) void renameEntry(d.path, value)
        } else if (d.type === 'delete') {
          void deleteEntry(d.path)
        } else if (d.type === 'openFolder') {
          if (value) void openFolder(value)
        }
      }}
      onCancel={() => setDialog(null)}
    />
  )

  if (!workspace) {
    return <WelcomeScreen error={error} onOpen={openFolder} />
  }

  const fileName = openFile?.split('/').pop() ?? null
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0

  return (
    <PlatformProvider>
      <ShikiThemeProvider shikiTheme={dark ? 'github-dark' : 'github-light'}>
        <div className="flex h-full w-full bg-background text-foreground">
          {/* Sidebar */}
          {sidebarOpen && (
            <aside className="craft-sidebar w-60 shrink-0 flex flex-col">
              <div className="flex items-center gap-2 h-11 px-3 border-b border-border">
                <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
                <span className="text-[13px] font-semibold truncate">{workspace.name}</span>
                <button
                  className="ml-auto p-1 rounded-[6px] text-foreground/50 hover:bg-foreground/[0.05] cursor-pointer"
                  onClick={() => setDialog({ type: 'openFolder', initial: workspace.root })}
                  title="Open another folder"
                >
                  <FolderOpen className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-1 p-2 border-b border-border">
                <ToolbarButton title="New file" onClick={() => setDialog({ type: 'newFile', folder: '' })}>
                  <FilePlus2 className="w-4 h-4" />
                </ToolbarButton>
                <ToolbarButton title="New folder" onClick={() => setDialog({ type: 'newFolder', folder: '' })}>
                  <FolderPlus className="w-4 h-4" />
                </ToolbarButton>
                <ToolbarButton title="Refresh" onClick={() => void loadTree()}>
                  <RefreshCw className="w-4 h-4" />
                </ToolbarButton>
              </div>
              <FileTree
                tree={tree}
                openFile={openFile}
                onOpenFile={(p) => void openFileByPath(p)}
                expanded={expanded}
                onToggle={(p) =>
                  setExpanded((prev) => {
                    const next = new Set(prev)
                    if (next.has(p)) next.delete(p)
                    else next.add(p)
                    return next
                  })
                }
                onNewFile={(f) => setDialog({ type: 'newFile', folder: f })}
                onNewFolder={(f) => setDialog({ type: 'newFolder', folder: f })}
                onRename={(p) => setDialog({ type: 'rename', path: p, name: p.split('/').pop() ?? '' })}
                onDelete={(p) => setDialog({ type: 'delete', path: p })}
                onMove={(from, toDir, opts) => void moveEntry(from, toDir, opts)}
              />
            </aside>
          )}

          {/* Main column */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* Top bar */}
            <header className="craft-topbar h-11 shrink-0 flex items-center gap-2 px-3">
              <button
                className="p-1.5 rounded-[6px] text-foreground/60 hover:bg-foreground/[0.05] cursor-pointer"
                onClick={() => setSidebarOpen((o) => !o)}
                title="Toggle sidebar"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
              <span className="text-[13px] font-semibold tracking-tight flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-accent" />
                Craft
              </span>
              <span className="h-4 w-px bg-border mx-1" />
              {fileName && <span className="text-[13px] text-foreground/80 truncate">{fileName}</span>}
              <span className="flex-1" />
              <SaveIndicator state={saveState} />
              <button
                className={cn(
                  'p-1.5 rounded-[6px] cursor-pointer',
                  globalSearchOpen ? 'text-accent bg-accent/10' : 'text-foreground/60 hover:bg-foreground/[0.05]'
                )}
                onClick={() => setGlobalSearchOpen((o) => !o)}
                title="Search workspace (Cmd+Shift+F)"
              >
                <Search className="w-4 h-4" />
              </button>
              <button
                className={cn(
                  'p-1.5 rounded-[6px] cursor-pointer disabled:opacity-40 disabled:cursor-default',
                  outlineOpen ? 'text-accent bg-accent/10' : 'text-foreground/60 hover:bg-foreground/[0.05]'
                )}
                onClick={() => setOutlineOpen((o) => !o)}
                title="Toggle outline (TOC)"
                disabled={!openFile}
              >
                <ListTree className="w-4 h-4" />
              </button>
              {openFile && (
                <button
                  className={cn(
                    'p-1.5 rounded-[6px] cursor-pointer',
                    viewMode === 'source'
                      ? 'text-accent bg-accent/10'
                      : 'text-foreground/60 hover:bg-foreground/[0.05]'
                  )}
                  onClick={() => setViewMode((m) => (m === 'wysiwyg' ? 'source' : 'wysiwyg'))}
                  title={viewMode === 'wysiwyg' ? 'View source (markdown)' : 'Back to editor'}
                >
                  {viewMode === 'wysiwyg' ? <Code2 className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              )}
              <button
                className="p-1.5 rounded-[6px] text-foreground/60 hover:bg-foreground/[0.05] cursor-pointer"
                onClick={toggleTheme}
                title="Toggle theme"
              >
                {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </header>

            {/* Tab bar */}
            {tabs.length > 0 && (
              <TabBar
                tabs={tabs}
                activePath={activePath}
                onActivate={(p) => {
                  void flushSave()
                  setActivePath(p)
                  setPendingSearch('')
                  localStorage.setItem(LAST_FILE_KEY, p)
                }}
                onClose={closeTab}
              />
            )}

            {/* Editor */}
            <main
              ref={mainRef}
              className="flex-1 min-h-0 overflow-y-auto"
              onScroll={computeActiveHeading}
            >
              {openFile ? (
                <div className="max-w-[760px] mx-auto px-8 py-8">
                  {viewMode === 'source' ? (
                    <SourceEditor
                      ref={sourceRef}
                      value={content}
                      onChange={handleEditorUpdate}
                      onTabIntoWysiwyg={() => setViewMode('wysiwyg')}
                    />
                  ) : (
                    <TiptapMarkdownEditor
                      ref={editorRef}
                      key={openFile}
                      content={content}
                      onUpdate={handleEditorUpdate}
                      placeholder="Start writing…"
                      initialSearchText={pendingSearch}
                    />
                  )}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-foreground/40">
                  <FileText2 className="w-10 h-10" />
                  <p className="text-sm">Select a markdown file from the sidebar, or create a new one.</p>
                </div>
              )}
            </main>

            {/* Status bar */}
            {openFile && (
              <footer className="h-6 shrink-0 flex items-center gap-4 px-3 text-[11px] text-foreground/40 border-t border-border">
                <span className="truncate">{openFile}</span>
                <span className="ml-auto">{wordCount} words</span>
                {error && <span className="text-destructive truncate max-w-60" title={error}>{error}</span>}
              </footer>
            )}
          </div>

          {/* Outline (TOC) */}
          {outlineOpen && openFile && (
            <DocumentOutline
              headings={outline}
              activeId={activeHeading}
              onNavigate={handleOutlineNavigate}
              onClose={() => setOutlineOpen(false)}
            />
          )}
        </div>
      </ShikiThemeProvider>
      {dialogNode}
      {globalSearchOpen && (
        <GlobalSearch
          onOpenResult={(path, query) => {
            setGlobalSearchOpen(false)
            setPendingSearch(query)
            void openFileByPath(path)
          }}
          onClose={() => setGlobalSearchOpen(false)}
        />
      )}
    </PlatformProvider>
  )
}

function ToolbarButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      className="p-1.5 rounded-[6px] text-foreground/60 hover:bg-foreground/[0.05] cursor-pointer"
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  )
}

function TabBar({
  tabs,
  activePath,
  onActivate,
  onClose,
}: {
  tabs: Array<{ path: string; content: string; saved: string }>
  activePath: string | null
  onActivate: (path: string) => void
  onClose: (path: string) => void
}) {
  return (
    <div className="flex items-center gap-0.5 h-9 px-2 overflow-x-auto shrink-0 border-b border-border bg-background-elevated/60">
      {tabs.map((tab) => {
        const name = tab.path.split('/').pop() ?? tab.path
        const dirty = tab.content !== tab.saved
        const active = tab.path === activePath
        return (
          <div
            key={tab.path}
            role="tab"
            aria-selected={active}
            onClick={() => onActivate(tab.path)}
            onMouseDown={(e) => e.preventDefault()}
            className={cn(
              'group flex items-center gap-1.5 h-7 px-3 rounded-[7px] text-[12.5px] cursor-pointer select-none whitespace-nowrap',
              active
                ? 'bg-foreground/[0.08] text-foreground'
                : 'text-foreground/60 hover:bg-foreground/[0.04] hover:text-foreground/80'
            )}
            title={tab.path}
          >
            <span
              className={cn(
                'w-1.5 h-1.5 rounded-full shrink-0',
                dirty ? 'bg-info' : active ? 'bg-accent' : 'bg-transparent'
              )}
            />
            <span className="max-w-40 truncate">{name}</span>
            <button
              className={cn(
                'p-0.5 rounded-[4px] cursor-pointer opacity-0 group-hover:opacity-100',
                active ? 'opacity-70 hover:opacity-100' : 'hover:bg-foreground/[0.06]'
              )}
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation()
                onClose(tab.path)
              }}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function SaveIndicator({ state }: { state: SaveState }) {
  const label: Record<SaveState, string> = {
    idle: '',
    dirty: 'Unsaved changes',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Save failed',
  }
  const dot: Record<SaveState, string> = {
    idle: 'bg-foreground/30',
    dirty: 'bg-info',
    saving: 'bg-info animate-pulse',
    saved: 'bg-success',
    error: 'bg-destructive',
  }
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-foreground/50">
      <span className={cn('w-1.5 h-1.5 rounded-full', dot[state])} />
      {label[state]}
    </span>
  )
}

function FileText2({ className }: { className?: string }) {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  )
}

function WelcomeScreen({ error, onOpen }: { error: string; onOpen: (root: string) => void }) {
  const [path, setPath] = useState('')
  const [loading, setLoading] = useState(false)

  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-background text-foreground gap-6">
      <div className="flex flex-col items-center gap-3">
        <span className="w-12 h-12 rounded-2xl bg-accent flex items-center justify-center shadow-modal-small">
          <ChevronLeft className="w-6 h-6 text-white rotate-45" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Craft</h1>
        <p className="text-[13px] text-foreground/50">A minimal markdown editor with instant rendering</p>
      </div>

      <form
        className="flex flex-col items-center gap-2 w-80"
        onSubmit={(e) => {
          e.preventDefault()
          if (!path.trim()) return
          setLoading(true)
          onOpen(path.trim())
          setTimeout(() => setLoading(false), 800)
        }}
      >
        <div className="flex w-full items-center gap-2 rounded-lg bg-background-elevated border border-border px-3 py-2 focus-within:border-foreground/20">
          <FolderOpen className="w-4 h-4 text-foreground/40 shrink-0" />
          <input
            autoFocus
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/path/to/your/folder"
            className="bg-transparent outline-none text-[13px] w-full placeholder:text-foreground/30"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !path.trim()}
          className="w-full rounded-lg bg-accent text-white text-[13px] font-medium py-2 cursor-pointer disabled:opacity-40"
        >
          {loading ? 'Opening…' : 'Open folder'}
        </button>
        {error && <p className="text-[12px] text-destructive max-w-full truncate">{error}</p>}
      </form>

      <p className="text-[12px] text-foreground/35 max-w-sm text-center">
        Tip: create a folder with markdown (.md) files first, e.g. <code className="text-foreground/50">mkdir -p ~/Documents/notes</code>
      </p>
    </div>
  )
}

function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node
    if (node.children) {
      const found = findNode(node.children, path)
      if (found) return found
    }
  }
  return null
}

function expandAncestors(path: string, add: (p: string) => void) {
  const parts = path.split('/')
  let acc = ''
  for (let i = 0; i < parts.length - 1; i++) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i]
    add(acc)
  }
}
