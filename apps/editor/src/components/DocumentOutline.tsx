import React, { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Hash, ListTree } from 'lucide-react'
import { buildOutlineTree } from './outline'
import type { OutlineHeading, OutlineNode } from './outline'
import { cn } from '../editor/lib/utils'

interface DocumentOutlineProps {
  headings: OutlineHeading[]
  activeId: string | null
  onNavigate: (heading: OutlineHeading) => void
  onClose: () => void
}

/** Visual weight per heading level (mainstream outline feel: h1 largest). */
const LEVEL_STYLE: Record<number, string> = {
  1: 'text-[13px] font-semibold text-foreground/90',
  2: 'text-[12.5px] font-medium text-foreground/75',
  3: 'text-[12px] text-foreground/60',
  4: 'text-[12px] text-foreground/55',
  5: 'text-[12px] text-foreground/50',
  6: 'text-[12px] text-foreground/50',
}

function OutlineRow({
  node,
  depth,
  activeId,
  collapsed,
  onToggle,
  onNavigate,
}: {
  node: OutlineNode
  depth: number
  activeId: string | null
  collapsed: Set<string>
  onToggle: (id: string) => void
  onNavigate: (heading: OutlineHeading) => void
}) {
  const { heading, children } = node
  const isActive = heading.id === activeId
  const hasChildren = children.length > 0
  const isCollapsed = collapsed.has(heading.id)

  return (
    <>
      <li>
        <div
          role="treeitem"
          aria-expanded={hasChildren ? !isCollapsed : undefined}
          aria-selected={isActive}
          onClick={() => onNavigate(heading)}
          onDoubleClick={() => hasChildren && onToggle(heading.id)}
          title={`Jump to "${heading.text}" (line ${heading.line})`}
          className={cn(
            'group flex items-center gap-1 w-full text-left pr-2 py-[5px] rounded-[6px] cursor-pointer select-none',
            isActive
              ? 'bg-accent/10'
              : 'hover:bg-foreground/[0.05]'
          )}
          style={{ paddingLeft: `${Math.min(depth, 5) * 12 + 6}px` }}
        >
          {hasChildren ? (
            <button
              className={cn(
                'p-0.5 rounded-[4px] cursor-pointer text-foreground/35 hover:text-foreground/70 shrink-0',
                isActive && 'text-accent'
              )}
              onClick={(e) => {
                e.stopPropagation()
                onToggle(heading.id)
              }}
              title={isCollapsed ? 'Expand' : 'Collapse'}
            >
              <ChevronRight
                className={cn('w-3 h-3 transition-transform duration-150', isCollapsed ? '' : 'rotate-90')}
              />
            </button>
          ) : (
            <span
              className={cn(
                'w-1 h-1 rounded-full shrink-0 mx-[5.5px]',
                isActive ? 'bg-accent' : 'bg-foreground/25 group-hover:bg-foreground/40'
              )}
            />
          )}
          <span className={cn('leading-snug truncate', LEVEL_STYLE[heading.level] ?? LEVEL_STYLE[6], isActive && 'text-accent')}>
            {heading.text || '(untitled heading)'}
          </span>
        </div>

        {hasChildren && !isCollapsed && (
          <ul role="group" className="space-y-px">
            {children.map((child) => (
              <OutlineRow
                key={child.heading.id}
                node={child}
                depth={depth + 1}
                activeId={activeId}
                collapsed={collapsed}
                onToggle={onToggle}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        )}
      </li>
    </>
  )
}

export function DocumentOutline({ headings, activeId, onNavigate, onClose }: DocumentOutlineProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const tree = useMemo(() => buildOutlineTree(headings), [headings])

  // Drop collapsed ids that no longer exist (file switched or heading removed).
  useEffect(() => {
    setCollapsed((prev) => {
      const valid = new Set(headings.map((h) => h.id))
      let changed = false
      for (const id of prev) {
        if (!valid.has(id)) changed = true
      }
      return changed ? new Set([...prev].filter((id) => valid.has(id))) : prev
    })
  }, [headings])

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <aside className="craft-outline w-56 shrink-0 flex flex-col">
      <div className="flex items-center gap-2 h-11 px-3 border-b border-border">
        <ListTree className="w-3.5 h-3.5 text-foreground/50" />
        <span className="text-[13px] font-semibold">Outline</span>
        <span className="text-[11px] text-foreground/35">{headings.length}</span>
        <button
          className="ml-auto p-1 rounded-[6px] text-foreground/50 hover:bg-foreground/[0.05] cursor-pointer"
          onClick={onClose}
          title="Hide outline"
        >
          <Hash className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1.5">
        {tree.length === 0 ? (
          <p className="px-3 py-4 text-[12px] text-foreground/35">
            No headings yet — add <code className="text-foreground/50">#</code> titles to build an outline.
          </p>
        ) : (
          <ul role="tree" className="space-y-px px-1">
            {tree.map((node) => (
              <OutlineRow
                key={node.heading.id}
                node={node}
                depth={0}
                activeId={activeId}
                collapsed={collapsed}
                onToggle={toggleCollapsed}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
