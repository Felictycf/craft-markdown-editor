/**
 * Document outline extraction: scan markdown for ATX headings (# … ######),
 * skipping fenced code blocks, and produce a flat list in document order.
 */

export interface OutlineHeading {
  /** Stable id: `${level}:${occurrence}` (occurrence counts same-level headings) */
  id: string
  /** Heading level 1–6 */
  level: number
  /** Display text with inline markdown stripped */
  text: string
  /** 1-based source line the heading starts on */
  line: number
  /** Occurrence index among headings of the same level (0-based) */
  occurrence: number
  /** Index among ALL headings in document order (0-based) */
  globalIndex: number
}

/** Strip inline markdown formatting so heading labels render clean. */
export function cleanHeadingText(raw: string): string {
  return raw
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\$\$?[^$]*\$\$?/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
}

const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/

export function extractOutline(markdown: string): OutlineHeading[] {
  const headings: OutlineHeading[] = []
  const occurrenceByLevel: Record<number, number> = {}
  const lines = markdown.split(/\r?\n/)
  let inFence = false
  let fenceMarker = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      const marker = fence[1][0]
      if (!inFence) {
        inFence = true
        fenceMarker = marker
      } else if (marker === fenceMarker) {
        inFence = false
      }
      continue
    }
    if (inFence) continue

    const match = line.match(ATX_HEADING)
    if (!match) continue

    const level = match[1].length
    const occurrence = occurrenceByLevel[level] ?? 0
    occurrenceByLevel[level] = occurrence + 1

    headings.push({
      id: `${level}:${occurrence}`,
      level,
      text: cleanHeadingText(match[2] ?? ''),
      line: i + 1,
      occurrence,
      globalIndex: headings.length,
    })
  }

  return headings
}

/** Nested heading node for the outline tree. */
export interface OutlineNode {
  heading: OutlineHeading
  children: OutlineNode[]
}

/**
 * Build a hierarchical tree from flat headings in document order.
 * A heading becomes a child of the nearest preceding heading with a
 * smaller level (level jumps attach to the closest ancestor).
 */
export function buildOutlineTree(headings: OutlineHeading[]): OutlineNode[] {
  const roots: OutlineNode[] = []
  const stack: Array<{ level: number; node: OutlineNode }> = []

  for (const heading of headings) {
    const node: OutlineNode = { heading, children: [] }
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
      stack.pop()
    }
    if (stack.length > 0) stack[stack.length - 1].node.children.push(node)
    else roots.push(node)
    stack.push({ level: heading.level, node })
  }

  return roots
}
