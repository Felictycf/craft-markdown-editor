import React, { useEffect, useRef, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { cn } from '../editor/lib/utils'

export interface DialogProps {
  title: string
  description?: string
  /** When set, renders a text input with this initial value */
  initialValue?: string
  /** When set, renders a "Browse…" button (native directory picker in the desktop app) */
  browse?: () => Promise<string | null>
  confirmLabel?: string
  danger?: boolean
  onConfirm: (value: string) => void
  onCancel: () => void
}

/**
 * Craft dialog — replaces window.prompt/confirm, which are disabled in
 * the Electron (macOS app) environment.
 */
export function Dialog({
  title,
  description,
  initialValue,
  browse,
  confirmLabel = 'OK',
  danger = false,
  onConfirm,
  onCancel,
}: DialogProps) {
  const [value, setValue] = useState(initialValue ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  const browsingRef = useRef(false)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const submit = () => {
    if (browsingRef.current) return
    onConfirm(value.trim())
  }

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative w-80 rounded-xl bg-popover text-popover-foreground shadow-modal-small p-4 flex flex-col gap-3"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-[14px] font-semibold">{title}</h2>
          {description && <p className="text-[12px] text-foreground/50 mt-0.5 break-all">{description}</p>}
        </div>

        {initialValue !== undefined && (
          <div className="flex items-center gap-2 rounded-lg bg-background-elevated border border-border px-2.5 py-1.5 focus-within:border-foreground/20">
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
              className="bg-transparent outline-none text-[13px] w-full placeholder:text-foreground/30"
              placeholder={title}
            />
            {browse && (
              <button
                onClick={async () => {
                  if (browsingRef.current) return
                  browsingRef.current = true
                  try {
                    const dir = await browse()
                    if (dir) setValue(dir)
                  } finally {
                    browsingRef.current = false
                  }
                }}
                className="p-1 rounded-[6px] text-foreground/50 hover:bg-foreground/[0.05] shrink-0 cursor-pointer"
                title="Browse…"
              >
                <FolderOpen className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-[13px] text-foreground/70 hover:bg-foreground/[0.05] cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            autoFocus={initialValue === undefined}
            className={cn(
              'px-3 py-1.5 rounded-lg text-[13px] font-medium text-white cursor-pointer disabled:opacity-40',
              danger ? 'bg-destructive' : 'bg-accent'
            )}
            disabled={initialValue !== undefined && value.trim().length === 0}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
