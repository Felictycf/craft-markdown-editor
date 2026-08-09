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
  onMove: (from: string, toDir: string) => void
}

interface MenuState {
  x: number
  y: number
  node: TreeNode
}

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
  const [dropTarget, setDropTarget] = useState<string | null>(null)

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
    e.dataTransfer.setData('text/craft-path', node.path)
    e.dataTransfer.effectAllowed = 'move'
    setDragPath(node.path)
    // Custom drag ghost: a small label following the cursor so you can
    // always see WHAT you are dragging.
    const ghost = document.createElement('div')
    ghost.textContent = node.name
    ghost.style.cssText =
      'padding:4px 10px;border-radius:8px;font:500 12px system-ui,sans-serif;' +
      'color:#fff;background:var(--accent);box-shadow:0 4px 12px rgba(0,0,0,.25);' +
      'pointer-events:none;white-space:nowrap;'
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 8, 8)
    setTimeout(() => ghost.remove(), 0)
  }, [])

  const isDragPayload = (e: React.DragEvent): boolean =>
    Array.from(e.dataTransfer.types).includes('text/craft-path')

  const handleDragOver = useCallback(
    (e: React.DragEvent, node: TreeNode | null) => {
      if (!isDragPayload(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      // Track the drop zone under the cursor:
      // - over a folder row → that folder
      // - anywhere else in the tree (background) → workspace root
      setDropTarget(node ? node.path : '')
    },
    [dragPath]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent, target: TreeNode | null) => {
      e.preventDefault()
      e.stopPropagation()
      const from = e.dataTransfer.getData('text/craft-path') || dragPath
      const toDir = target ? target.path : ''
      setDropTarget(null)
      setDragPath(null)
      if (from && from !== toDir) {
        onMove(from, toDir)
      }
    },
    [dragPath, onMove]
  )

  const renderNode = useCallback(
    (node: TreeNode, depth: number) => {
      const isFolder = node.type === 'folder'
      const isExpanded = isFolder && expanded.has(node.path)
      const isSelected = !isFolder && node.path === openFile
      const isEditable = !isFolder && !!node.editable
      const isDropTarget = isFolder && dropTarget === node.path
      const isDragging = dragPath === node.path

      return (
        <div key={node.path}>
          <div
            role="treeitem"
            draggable
            onDragStart={(e) => handleDragStart(e, node)}
            onDragEnter={(e) => {
              if (isFolder && isDragPayload(e)) {
                e.stopPropagation()
                setDropTarget(node.path)
              }
            }}
            onDragOver={(e) => {
              if (isFolder && isDragPayload(e)) {
                e.stopPropagation()
              }
              handleDragOver(e, isFolder ? node : null)
            }}
            onDragLeave={(e) => {
              if (isFolder && isDragPayload(e) && !e.currentTarget.contains(e.relatedTarget as Node)) {
                setDropTarget((d) => (d === node.path ? null : d))
              }
            }}
            onDrop={(e) => handleDrop(e, isFolder ? node : null)}
            className={cn(
              'group flex items-center gap-1 h-7 pr-2 cursor-pointer select-none',
              'text-[13px] rounded-[6px] mx-1',
              isSelected ? 'bg-foreground/[0.06] text-foreground' : 'text-foreground/70 hover:bg-foreground/[0.03] hover:text-foreground',
              // Dragging state: the source row fades so it's obvious you're
              // holding it.
              isDragging && 'opacity-40',
              // Drop-zone state: accent fill + left bar + ring so the target
              // folder is unmistakable.
              isDropTarget &&
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
          {isFolder && isExpanded && node.children?.map((child) => renderNode(child, depth + 1))}
        </div>
      )
    },
    [expanded, openFile, onToggle, onOpenFile, openMenu, dropTarget, dragPath, handleDragOver, handleDragStart, handleDrop]
  )

  return (
    <div
      className="flex-1 overflow-y-auto py-1"
      role="tree"
      onDragEnter={(e) => {
        if (isDragPayload(e)) setDropTarget('')
      }}
      onDragOver={(e) => handleDragOver(e, null)}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null)
      }}
      onDrop={(e) => handleDrop(e, null)}
    >
      {/* Drop-zone hint while dragging over the tree background (workspace root) */}
      {dragPath && dropTarget === '' && (
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
