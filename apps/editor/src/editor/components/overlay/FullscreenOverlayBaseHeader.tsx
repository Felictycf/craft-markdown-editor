/**
 * FullscreenOverlayBaseHeader - Header component for fullscreen overlays
 *
 * Builds a badge row from structured props (typeBadge, filePath, title, subtitle).
 * Simplified for the standalone Craft editor: no platform menus (open/reveal)
 * are available in the browser, so the file path renders as a static badge.
 */

import { useState, useCallback, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, type LucideIcon } from 'lucide-react'
import { PreviewHeader, PreviewHeaderBadge, type PreviewBadgeVariant } from '../ui/PreviewHeader'
import { cn } from '../../lib/utils'

/** Structured type badge — tool/format indicator (e.g. "Read", "Image", "Bash") */
export interface OverlayTypeBadge {
  icon: LucideIcon
  label: string
  variant?: PreviewBadgeVariant
}

export interface FullscreenOverlayBaseHeaderProps {
  /** Close handler — shows X button in header */
  onClose: () => void
  /** Type badge — tool/format indicator */
  typeBadge?: OverlayTypeBadge
  /** File path — shows a static badge */
  filePath?: string
  /** Title — displayed as a badge. Fallback when no file path. */
  title?: string
  /** Click handler for the title badge */
  onTitleClick?: () => void
  /** Subtitle — extra info badge (e.g. "Lines 1-50 of 200") */
  subtitle?: string
  /** Right-side actions (e.g. diff controls) */
  headerActions?: ReactNode
  /** When provided, renders a built-in copy button (matching close button style) */
  copyContent?: string
}

/**
 * Truncates a file path to show just the filename for display in the badge.
 * Full path is available via tooltip.
 */
function displayPath(filePath: string): string {
  const parts = filePath.split('/')
  const name = parts.pop() || filePath
  // Show parent dir + filename if available (e.g. "src/App.tsx")
  if (parts.length > 0) {
    const parent = parts.pop()
    return `${parent}/${name}`
  }
  return name
}

export function FullscreenOverlayBaseHeader({
  onClose,
  typeBadge,
  filePath,
  title,
  onTitleClick,
  subtitle,
  headerActions,
  copyContent,
}: FullscreenOverlayBaseHeaderProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    if (!copyContent) return
    try {
      await navigator.clipboard.writeText(copyContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [copyContent])

  // Built-in copy button + any custom header actions, rendered in PreviewHeader's right actions area
  const rightActions = (
    <>
      {copyContent != null && (
        <button
          onClick={handleCopy}
          className={cn(
            'p-1.5 rounded-[6px] bg-background shadow-minimal cursor-pointer',
            'opacity-70 hover:opacity-100 transition-opacity',
            'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring'
          )}
          title={copied ? t('common.copied') : t('common.copyAll')}
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </button>
      )}
      {headerActions}
    </>
  )

  return (
    <PreviewHeader onClose={onClose} height={48} rightActions={rightActions}>
      {typeBadge && (
        <PreviewHeaderBadge
          icon={typeBadge.icon}
          label={typeBadge.label}
          variant={typeBadge.variant}
        />
      )}
      {filePath ? (
        <PreviewHeaderBadge label={displayPath(filePath)} title={filePath} shrinkable />
      ) : title ? (
        <PreviewHeaderBadge label={title} onClick={onTitleClick} shrinkable />
      ) : null}
      {subtitle && <PreviewHeaderBadge label={subtitle} />}
    </PreviewHeader>
  )
}
