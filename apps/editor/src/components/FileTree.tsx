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
}: FileTreeProps) {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

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

  const renderNode = useCallback(
    (node: TreeNode, depth: number) => {
      const isFolder = node.type === 'folder'
      const isExpanded = isFolder && expanded.has(node.path)
      const isSelected = !isFolder && node.path === openFile
      const isEditable = !isFolder && !!node.editable

      return (
        <div key={node.path}>
          <div
            role="treeitem"
            className={cn(
              'group flex items-center gap-1 h-7 pr-2 cursor-pointer select-none',
              'text-[13px] rounded-[6px] mx-1',
              isSelected ? 'bg-foreground/[0.06] text-foreground' : 'text-foreground/70 hover:bg-foreground/[0.03] hover:text-foreground'
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
    [expanded, openFile, onToggle, onOpenFile, openMenu]
  )

  return (
    <div className="flex-1 overflow-y-auto py-1" role="tree">
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
