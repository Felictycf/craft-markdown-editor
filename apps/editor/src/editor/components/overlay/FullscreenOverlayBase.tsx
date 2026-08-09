/**
 * FullscreenOverlayBase - Base component for all fullscreen overlays
 *
 * Simplified for the standalone Craft editor: plain fixed overlay rendered
 * into a portal, with Escape-to-close and focus management (no Radix deps).
 *
 * Layout:
 *   Container (fixed inset-0, relative)
 *   ├── Masked area (absolute inset-0, CSS mask gradient)
 *   │   └── Scroll container (h-full, overflow-y-auto, paddingTop = header + fade)
 *   │       └── {error banner}
 *   │       └── {children}
 *   └── Header (absolute top-0, z-10, floating on top of scroll content)
 */

import { useEffect, useRef, type ReactNode } from 'react'
import * as ReactDOM from 'react-dom'
import { cn } from '../../lib/utils'
import { getDismissibleLayerBridge } from '../../lib/dismissible-layer-bridge'
import { FullscreenOverlayBaseHeader, type OverlayTypeBadge } from './FullscreenOverlayBaseHeader'
import { OverlayErrorBanner, type OverlayErrorBannerProps } from './OverlayErrorBanner'

// Z-index for fullscreen overlays - must be above app chrome
const Z_FULLSCREEN = 'var(--z-fullscreen, 350)'

// HEADER_HEIGHT must match PreviewHeader's height prop (48px).
// FADE_SIZE is the transition zone where content fades in/out at edges.
const HEADER_HEIGHT = 48
const FADE_SIZE = 24

// Edge-to-edge gradient fade mask — starts at y=0, fades over FADE_SIZE at both edges.
const FADE_MASK = `linear-gradient(to bottom, transparent 0px, black ${FADE_SIZE}px, black calc(100% - ${FADE_SIZE}px), transparent 100%)`

export interface FullscreenOverlayBaseProps {
  /** Whether the overlay is visible */
  isOpen: boolean
  /** Callback when the overlay should close (ESC key triggers this) */
  onClose: () => void
  /** Content to render inside the overlay */
  children: ReactNode
  /** Additional CSS classes for the container */
  className?: string
  /** Accessible title for the overlay (visually hidden) */
  accessibleTitle?: string

  // --- Structured header props (optional) ---

  /** Type badge — tool/format indicator (e.g. "Read", "Image", "Bash") */
  typeBadge?: OverlayTypeBadge
  /** File path — shows a static badge */
  filePath?: string
  /** Title — displayed as a badge when no filePath */
  title?: string
  /** Click handler for the title badge */
  onTitleClick?: () => void
  /** Subtitle — extra info badge (e.g. "Lines 1-50 of 200") */
  subtitle?: string
  /** Right-side header actions (e.g. diff controls) */
  headerActions?: ReactNode
  /** When provided, renders a built-in copy button in the header right actions area */
  copyContent?: string

  /** Optional error banner — rendered between header and children */
  error?: OverlayErrorBannerProps
}

export function handleFullscreenEscapeWithStack(): boolean {
  const bridge = getDismissibleLayerBridge()
  if (!bridge) return false
  return bridge.handleEscape()
}

export function FullscreenOverlayBase({
  isOpen,
  onClose,
  children,
  className,
  accessibleTitle = 'Overlay',
  typeBadge,
  filePath,
  title,
  onTitleClick,
  subtitle,
  headerActions,
  copyContent,
  error,
}: FullscreenOverlayBaseProps) {
  // Determine if we should render the structured header.
  const hasHeader = !!(typeBadge || filePath || title || subtitle || headerActions || copyContent)
  const overlayIdRef = useRef(`fullscreen-overlay-${Math.random().toString(36).slice(2)}`)

  useEffect(() => {
    if (!isOpen) return

    const bridge = getDismissibleLayerBridge()
    if (!bridge) return

    return bridge.registerLayer({
      id: overlayIdRef.current,
      type: 'radix-dialog',
      priority: 100,
      close: onClose,
    })
  }, [isOpen, onClose])

  // Escape key handling + focus management
  useEffect(() => {
    if (!isOpen) return

    const previousFocus = document.activeElement as HTMLElement | null

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const handled = handleFullscreenEscapeWithStack()
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  // Content padding clears the floating header at rest (when present).
  const contentPaddingTop = hasHeader ? HEADER_HEIGHT + FADE_SIZE : FADE_SIZE

  return ReactDOM.createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={accessibleTitle}
      className={cn(
        'fixed inset-0 overflow-hidden outline-none',
        'bg-foreground-3 fullscreen-overlay-background',
        className
      )}
      style={{ zIndex: Z_FULLSCREEN }}
    >
      {/* Full-viewport masked scroll area */}
      <div
        className="absolute inset-0"
        style={{ maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK }}
      >
        <div
          className="h-full overflow-y-auto"
          style={{ paddingTop: contentPaddingTop, paddingBottom: FADE_SIZE, scrollPaddingTop: contentPaddingTop }}
        >
          <div className="min-h-full flex flex-col justify-center">
            {error && (
              <div className="px-6 pb-4">
                <OverlayErrorBanner label={error.label} message={error.message} />
              </div>
            )}
            {children}
          </div>
        </div>
      </div>

      {/* Floating header */}
      {hasHeader && (
        <div className="absolute top-0 left-0 right-0 z-10">
          <FullscreenOverlayBaseHeader
            onClose={onClose}
            typeBadge={typeBadge}
            filePath={filePath}
            title={title}
            onTitleClick={onTitleClick}
            subtitle={subtitle}
            headerActions={headerActions}
            copyContent={copyContent}
          />
        </div>
      )}
    </div>,
    document.body
  )
}
