import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronRight,
  File as FileIcon,
  FileText,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import type { TreeNode } from '../api'
import { cn } from '../editor/lib/utils'

interface FileTreeProps {
  tree: TreeNode[]
  openFile: string | null
  onOpenFile: (path: string) => void
  expanded: Set<string>
  onToggle: (path: string) => void
  onNewFile: (folderPath: string) => void
  onNewFolder: (folderPath: string) => void
  onRename: (path: string) => void
  onDelete: (path: string) => void
  onMove: (from: string, toDir: string, opts?: { anchor?: string; before?: boolean }) => void
}

interface MenuState {
  x: number
  y: number
  node: TreeNode
}

/** Where the dragged item would land */
type DropTarget =
  | { kind: 'folder'; path: string } // over a folder → move INTO it (folder highlights)
  | { kind: 'line'; path: string; pos: 'before' | 'after' } // between rows → insertion line
  | { kind: 'root' } // tree background → workspace root
  | null

export function FileTree({
  tree,
  openFile,
  onOpenFile,
  expanded,
  onToggle,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onMove,
}: FileTreeProps) {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [dragPath, setDragPath] = useState<string | null>(null)
  const dragPathRef = useRef<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget>(null)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const openMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, node })
  }, [])

  const handleDragStart = useCallback((e: React.DragEvent, node: TreeNode) => {
    // Best-effort payload (some Electron builds drop custom MIME types);
    // the authoritative source is dragPathRef, kept in sync below.
    try {
      e.dataTransfer.setData('text/craft-path', node.path)
    } catch {
      // ignore — ref fallback covers this
    }
    e.dataTransfer.effectAllowed = 'move'
    setDragPath(node.path)
    dragPathRef.current = node.path
  }, [])

  const clearDrag = useCallback(() => {
    setDragPath(null)
    dragPathRef.current = null
    setDropTarget(null)
  }, [])

  /**
   * Decide the drop zone from the cursor position inside a row:
   * - folders: the whole row → move INTO the folder (folder highlights)
   * - files: an insertion line (before/after) → move to that file's folder
   *
   * preventDefault is ALWAYS called (no dataTransfer inspection): the
   * drop event only fires on elements whose dragover was default-prevented,
   * and inspecting types is unreliable inside Electron.
   */
  const handleRowDragOver = useCallback((e: React.DragEvent, node: TreeNode) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (node.type === 'folder') {
      setDropTarget({ kind: 'folder', path: node.path })
    } else {
      const rect = e.currentTarget.getBoundingClientRect()
      const rel = (e.clientY - rect.top) / rect.height
      setDropTarget({ kind: 'line', path: node.path, pos: rel < 0.5 ? 'before' : 'after' })
    }
  }, [])

  const handleRowDrop = useCallback(
    (e: React.DragEvent, node: TreeNode) => {
      e.preventDefault()
      e.stopPropagation()
      // Authoritative drag source: the ref (dataTransfer payload may be
      // unavailable in Electron).
      const from = dragPathRef.current ?? dragPath
      clearDrag()
      if (!from) return
      if (node.type === 'folder') {
        // Drop on a folder → move INTO it
        if (from !== node.path) onMove(from, node.path)
      } else {
        // Drop on a file → move to that file's parent folder and INSERT
        // at the line position (before/after the target file)
        const parent = dirOf(node.path)
        const rect = e.currentTarget.getBoundingClientRect()
        const rel = (e.clientY - rect.top) / rect.height
        onMove(from, parent, { anchor: node.name, before: rel < 0.5 })
      }
    },
    [dragPath, onMove, clearDrag]
  )

  const renderNode = useCallback(
    (node: TreeNode, depth: number) => {
      const isFolder = node.type === 'folder'
      const isExpanded = isFolder && expanded.has(node.path)
      const isSelected = !isFolder && node.path === openFile
      const isEditable = !isFolder && !!node.editable
      const isDropFolder = dropTarget?.kind === 'folder' && dropTarget.path === node.path
      const isLineBefore = dropTarget?.kind === 'line' && dropTarget.path === node.path && dropTarget.pos === 'before'
      const isLineAfter = dropTarget?.kind === 'line' && dropTarget.path === node.path && dropTarget.pos === 'after'
      const isDragging = dragPath === node.path

      return (
        <div key={node.path} className="relative">
          {isLineBefore && <DropLine />}
          <div
            role="treeitem"
            draggable
            onDragStart={(e) => handleDragStart(e, node)}
            onDragEnter={(e) => handleRowDragOver(e, node)}
            onDragOver={(e) => handleRowDragOver(e, node)}
            onDragLeave={(e) => {
              if (dragPathRef.current && !e.currentTarget.contains(e.relatedTarget as Node)) {
                setDropTarget(null)
              }
            }}
            onDrop={(e) => handleRowDrop(e, node)}
            className={cn(
              'group flex items-center gap-1 h-7 pr-2 cursor-pointer select-none',
              'text-[13px] rounded-[6px] mx-1',
              isSelected ? 'bg-foreground/[0.06] text-foreground' : 'text-foreground/70 hover:bg-foreground/[0.03] hover:text-foreground',
              // Source row fades while dragged
              isDragging && 'opacity-40',
              // Move INTO this folder → folder highlights
              isDropFolder &&
                'bg-accent/20 text-foreground ring-1 ring-inset ring-accent/70 shadow-[inset_2px_0_0_0_var(--accent)]'
            )}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => (isFolder ? onToggle(node.path) : onOpenFile(node.path))}
            onContextMenu={(e) => openMenu(e, node)}
          >
            {isFolder ? (
              <ChevronRight
                className={cn('w-3.5 h-3.5 shrink-0 text-foreground/40 transition-transform', isExpanded && 'rotate-90')}
              />
            ) : (
              <span className="w-3.5 shrink-0" />
            )}
            {isFolder ? (
              isExpanded ? (
                <FolderOpen className="w-4 h-4 shrink-0 text-foreground/45" />
              ) : (
                <Folder className="w-4 h-4 shrink-0 text-foreground/45" />
              )
            ) : isEditable ? (
              <FileText className="w-4 h-4 shrink-0 text-foreground/45" />
            ) : (
              <FileIcon className="w-4 h-4 shrink-0 text-foreground/30" />
            )}
            <span className="truncate">{node.name}</span>
            <button
              className="ml-auto p-0.5 rounded-[4px] opacity-0 group-hover:opacity-100 hover:bg-foreground/[0.06] cursor-pointer"
              onClick={(e) => openMenu(e, node)}
              title="Actions"
            >
              <MoreHorizontal className="w-3.5 h-3.5 text-foreground/50" />
            </button>
          </div>
          {isLineAfter && <DropLine />}
          {isFolder && isExpanded && node.children?.map((child) => renderNode(child, depth + 1))}
        </div>
      )
    },
    [expanded, openFile, onToggle, onOpenFile, openMenu, dropTarget, dragPath, handleDragStart, handleRowDragOver, handleRowDrop]
  )

  return (
    <div
      className="flex-1 overflow-y-auto py-1"
      role="tree"
      onDragEnter={(e) => {
        if (dragPathRef.current) setDropTarget({ kind: 'root' })
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDropTarget({ kind: 'root' })
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null)
      }}
      onDrop={(e) => {
        e.preventDefault()
        const from = dragPathRef.current ?? dragPath
        clearDrag()
        if (from) onMove(from, '')
      }}
    >
      {/* Drop-zone hint while dragging over the tree background (workspace root) */}
      {dragPath && dropTarget?.kind === 'root' && (
        <div className="mx-1 mb-1 flex items-center gap-1.5 rounded-[6px] border border-dashed border-accent/70 bg-accent/10 px-2 py-1 text-[11.5px] font-medium text-accent">
          <Folder className="w-3.5 h-3.5" />
          Move to workspace root
        </div>
      )}
      {tree.map((node) => renderNode(node, 0))}
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-[var(--z-dropdown)] min-w-44 rounded-lg bg-popover text-popover-foreground shadow-modal-small p-1 text-[13px]"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <MenuItem icon={<Plus className="w-3.5 h-3.5" />} label="New file" onClick={() => { setMenu(null); onNewFile(menu.node.type === 'folder' ? menu.node.path : dirOf(menu.node.path)) }} />
          <MenuItem icon={<FolderPlus />} label="New folder" onClick={() => { setMenu(null); onNewFolder(menu.node.type === 'folder' ? menu.node.path : dirOf(menu.node.path)) }} />
          <MenuItem icon={<Pencil className="w-3.5 h-3.5" />} label="Rename" onClick={() => { setMenu(null); onRename(menu.node.path) }} />
          <div className="h-px bg-border my-1" />
          <MenuItem icon={<Trash2 className="w-3.5 h-3.5 text-destructive" />} label="Delete" danger onClick={() => { setMenu(null); onDelete(menu.node.path) }} />
        </div>
      )}
    </div>
  )
}

function dirOf(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx > 0 ? path.slice(0, idx) : ''
}

/**
 * Insertion indicator: a 2px accent line where the dragged item would land.
 */
function DropLine() {
  return (
    <div className="pointer-events-none absolute left-1 right-1 z-10 h-[2px] rounded-full bg-accent shadow-[0_0_0_1px_color-mix(in_oklch,var(--accent)_40%,transparent)]" style={{ top: -1 }} />
  )
}

function FolderPlus() {
  return <Plus className="w-3.5 h-3.5" />
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      className={cn(
        'flex items-center gap-2 w-full px-2 py-1.5 rounded-[6px] text-left cursor-pointer',
        danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground/80 hover:bg-foreground/[0.05]'
      )}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  )
}
