import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Search, X } from 'lucide-react'
import * as api from '../api'
import type { SearchResult } from '../api'

/**
 * Global search across the workspace (Cmd+Shift+F).
 * Results are grouped by file; clicking a result opens the file and jumps
 * to the first match.
 */
export function GlobalSearch({
  onOpenResult,
  onClose,
}: {
  onOpenResult: (path: string, query: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) {
      setResults(null)
      return
    }
    setSearching(true)
    try {
      const { results } = await api.searchFiles(trimmed)
      setResults(results)
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  // Debounce
  useEffect(() => {
    const t = setTimeout(() => void runSearch(query), 250)
    return () => clearTimeout(t)
  }, [query, runSearch])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const total = results?.reduce((n, r) => n + r.matches.length, 0) ?? 0

  return (
    <>
      {/* Full-viewport backdrop — click anywhere outside the panel to close */}
      <div className="fixed inset-0 z-[var(--z-modal)] bg-black/20" onMouseDown={onClose} />
      <div className="fixed inset-x-0 top-0 z-[var(--z-modal)]">
        <div className="relative mx-auto mt-16 w-[640px] max-w-[90vw] rounded-xl bg-popover text-popover-foreground shadow-modal-small border border-border overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
          <Search className="w-4 h-4 text-foreground/40 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search markdown in workspace…"
            className="bg-transparent outline-none text-[13.5px] w-full placeholder:text-foreground/30"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'Enter') {
                const first = results?.[0]
                if (first) onOpenResult(first.path, query.trim())
              }
            }}
          />
          <span className="text-[11.5px] text-foreground/40 whitespace-nowrap tabular-nums">
            {searching ? '…' : results ? `${total} match${total === 1 ? '' : 'es'}` : ''}
          </span>
          <button
            className="p-1 rounded-[6px] text-foreground/50 hover:bg-foreground/[0.05] cursor-pointer"
            onClick={onClose}
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto py-1">
          {results === null ? (
            <p className="px-4 py-6 text-center text-[12.5px] text-foreground/40">
              Type to search across all markdown files
            </p>
          ) : results.length === 0 ? (
            <p className="px-4 py-6 text-center text-[12.5px] text-foreground/40">No matches</p>
          ) : (
            results.map((r) => (
              <div key={r.path} className="px-2 py-0.5">
                <div className="flex items-center gap-1.5 px-2 py-1 text-[12px] text-foreground/50">
                  <FileText className="w-3.5 h-3.5 shrink-0" />
                  <span className="font-medium text-foreground/70">{r.path}</span>
                  <span className="ml-auto">{r.matches.length}</span>
                </div>
                {r.matches.map((m, i) => (
                  <button
                    key={i}
                    className="w-full text-left px-2 py-1 rounded-[6px] hover:bg-foreground/[0.05] cursor-pointer group"
                    onClick={() => onOpenResult(r.path, query.trim())}
                  >
                    <span className="text-[11px] text-foreground/35 mr-2 tabular-nums">{m.line}</span>
                    <span className="text-[12.5px] text-foreground/70 group-hover:text-foreground whitespace-nowrap overflow-hidden text-ellipsis align-middle">
                      {highlightMatch(m.text, query.trim())}
                    </span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
      </div>
    </>
  )
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-transparent text-accent font-semibold">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  )
}
