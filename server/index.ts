/**
 * Craft Markdown Editor — file server (Bun, zero dependencies)
 *
 * - Serves the built editor (apps/editor/dist)
 * - REST API for the workspace: tree, read/write/create/delete/rename files
 *
 * All file paths are relative to the workspace root and are checked to stay
 * inside it. The workspace root persists in ~/.craft-editor/state.json.
 */

import { readdir, readFile, writeFile, mkdir, stat, rm, rename } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve, sep, extname, basename } from 'node:path'
import { homedir } from 'node:os'

const PORT = Number(process.env.CRAFT_PORT ?? 8787)
const DIST_DIR = join(import.meta.dir, '..', 'apps', 'editor', 'dist')
const STATE_DIR = join(homedir(), '.craft-editor')
const STATE_FILE = join(STATE_DIR, 'state.json')
const MAX_TREE_DEPTH = 12

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.cache', '.next', '.vite', '.svelte-kit', '.turbo'])

function loadState(): string | null {
  try {
    const raw = readFileSync(STATE_FILE, 'utf8')
    const parsed = JSON.parse(raw) as { root?: string }
    return typeof parsed.root === 'string' && parsed.root.length > 0 ? parsed.root : null
  } catch {
    return null
  }
}

function persistState() {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify({ root }, null, 2))
  } catch (err) {
    console.error('[craft] failed to persist state:', err)
  }
}

let root: string | null = loadState()

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

function requireRoot(): string {
  if (!root) throw new Error('No workspace open')
  return root
}

function safeResolve(rel: string): string {
  const base = requireRoot()
  const abs = resolve(base, rel)
  if (abs !== base && !abs.startsWith(base + sep)) {
    throw new Error('Path escapes workspace')
  }
  return abs
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'folder'
  children?: TreeNode[]
  editable?: boolean
}

async function buildTree(dir: string, depth: number): Promise<TreeNode[]> {
  if (depth > MAX_TREE_DEPTH) return []
  const entries = await readdir(dir, { withFileTypes: true })
  entries.sort((a, b) => {
    const ad = a.isDirectory() ? 0 : 1
    const bd = b.isDirectory() ? 0 : 1
    return ad - bd || a.name.localeCompare(b.name)
  })

  const nodes: TreeNode[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
    const abs = join(dir, entry.name)
    const rel = abs.slice(requireRoot().length + 1).split(sep).join('/')
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: rel,
        type: 'folder',
        children: await buildTree(abs, depth + 1),
      })
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase()
      nodes.push({
        name: entry.name,
        path: rel,
        type: 'file',
        editable: ext === '.md' || ext === '.markdown',
      })
    }
  }
  return nodes
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function jsonError(status: number, message: string): Response {
  return json(status, { error: message })
}

async function handleApi(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname

  try {
    // --- workspace state -------------------------------------------------
    if (path === '/api/state' && req.method === 'GET') {
      return json(200, { root, name: root ? basename(root) : '' })
    }

    if (path === '/api/workspace' && req.method === 'POST') {
      const body = (await req.json()) as { root?: string }
      const candidate = body.root?.trim()
      if (!candidate) return jsonError(400, 'Missing root path')

      const resolved = resolve(candidate)
      let info
      try {
        info = await stat(resolved)
      } catch {
        return jsonError(400, `Folder does not exist: ${candidate}`)
      }
      if (!info.isDirectory()) return jsonError(400, `Not a folder: ${candidate}`)

      root = resolved
      persistState()
      return json(200, { root, name: basename(root) })
    }

    // --- tree ------------------------------------------------------------
    if (path === '/api/tree' && req.method === 'GET') {
      requireRoot()
      const tree = await buildTree(root!, 0)
      return json(200, tree)
    }

    // --- file read -------------------------------------------------------
    if (path === '/api/file' && req.method === 'GET') {
      const rel = url.searchParams.get('path')
      if (!rel) return jsonError(400, 'Missing path')
      const abs = safeResolve(rel)
      const content = await readFile(abs, 'utf8')
      return json(200, { content })
    }

    // --- file write ------------------------------------------------------
    if (path === '/api/file' && req.method === 'POST') {
      const body = (await req.json()) as { path?: string; content?: string }
      if (!body.path) return jsonError(400, 'Missing path')
      const abs = safeResolve(body.path)
      await mkdir(dirnameOf(abs), { recursive: true })
      await writeFile(abs, body.content ?? '', 'utf8')
      return json(200, { ok: true })
    }

    // --- create entry ----------------------------------------------------
    if (path === '/api/entry' && req.method === 'POST') {
      const body = (await req.json()) as { path?: string; type?: 'file' | 'folder' }
      if (!body.path) return jsonError(400, 'Missing path')
      if (body.type !== 'file' && body.type !== 'folder') return jsonError(400, 'Invalid type')
      const abs = safeResolve(body.path)
      await mkdir(dirnameOf(abs), { recursive: true })
      if (body.type === 'folder') await mkdir(abs, { recursive: true })
      else await writeFile(abs, '', 'utf8')
      return json(200, { ok: true })
    }

    // --- delete entry ----------------------------------------------------
    if (path === '/api/entry' && req.method === 'DELETE') {
      const rel = url.searchParams.get('path')
      if (!rel) return jsonError(400, 'Missing path')
      const abs = safeResolve(rel)
      await rm(abs, { recursive: true, force: true })
      return json(200, { ok: true })
    }

    // --- rename ----------------------------------------------------------
    if (path === '/api/rename' && req.method === 'POST') {
      const body = (await req.json()) as { from?: string; to?: string }
      if (!body.from || !body.to) return jsonError(400, 'Missing from/to')
      const fromAbs = safeResolve(body.from)
      const toAbs = safeResolve(body.to)
      await mkdir(dirnameOf(toAbs), { recursive: true })
      await rename(fromAbs, toAbs)
      return json(200, { ok: true })
    }

    // --- move (drag & drop in the file tree) ------------------------------
    // POST /api/move { from, toDir } → moves a file/folder into toDir
    if (path === '/api/move' && req.method === 'POST') {
      const body = (await req.json()) as { from?: string; toDir?: string }
      if (!body.from) return jsonError(400, 'Missing from')
      const fromAbs = safeResolve(body.from)
      const dirAbs = safeResolve(body.toDir ?? '')
      if (body.toDir) {
        const dirInfo = await stat(dirAbs)
        if (!dirInfo.isDirectory()) return jsonError(400, 'Target is not a folder')
      } else {
        // empty toDir = workspace root
        if (dirnameOf(fromAbs) === requireRoot()) return json(200, { ok: true, to: body.from })
      }
      // Prevent moving into itself or its own subtree
      if (fromAbs === dirAbs || dirAbs.startsWith(fromAbs + sep)) {
        return jsonError(400, 'Cannot move into itself')
      }
      const name = basename(fromAbs)
      const target = join(dirAbs, name)
      if (existsSync(target)) return jsonError(400, `Already exists: ${basename(fromAbs)}`)
      await rename(fromAbs, target)
      const rel = target.slice(requireRoot().length + 1).split(sep).join('/')
      return json(200, { ok: true, to: rel })
    }

    // --- global search across the workspace --------------------------------
    // GET /api/search?q=term → { results: [{ path, name, matches: [{line, text}] }] }
    if (path === '/api/search' && req.method === 'GET') {
      const q = (url.searchParams.get('q') ?? '').trim()
      if (!q) return jsonError(400, 'Missing query')
      const needle = q.toLowerCase()
      const results: Array<{ path: string; name: string; matches: Array<{ line: number; text: string }> }> = []

      const walk = async (dir: string): Promise<void> => {
        const entries = await readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
          const abs = join(dir, entry.name)
          if (entry.isDirectory()) {
            await walk(abs)
            continue
          }
          const ext = extname(entry.name).toLowerCase()
          if (ext !== '.md' && ext !== '.markdown') continue
          const rel = abs.slice(requireRoot().length + 1).split(sep).join('/')
          let text: string
          try {
            text = await readFile(abs, 'utf8')
          } catch {
            continue
          }
          const matches: Array<{ line: number; text: string }> = []
          text.split(/\r?\n/).forEach((line, idx) => {
            if (line.toLowerCase().includes(needle)) {
              matches.push({ line: idx + 1, text: line.trim().slice(0, 200) })
            }
          })
          if (matches.length > 0) {
            results.push({ path: rel, name: entry.name, matches: matches.slice(0, 100) })
          }
        }
      }

      await walk(requireRoot())
      results.sort((a, b) => a.path.localeCompare(b.path))
      return json(200, { results })
    }

    // --- workspace assets (images referenced from markdown) --------------
    // GET /api/assets?path=images/foo.png → serves the file from the workspace
    if (path === '/api/assets' && req.method === 'GET') {
      const rel = url.searchParams.get('path')
      if (!rel) return jsonError(400, 'Missing path')
      const abs = safeResolve(rel)
      const info = await stat(abs)
      if (!info.isFile()) return jsonError(404, 'Not a file')
      const ext = extname(abs).toLowerCase()
      const body = await readFile(abs)
      return new Response(body, {
        headers: { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': 'private, max-age=3600' },
      })
    }

    // --- image upload (paste/drop into the editor) -----------------------
    // POST /api/upload { filename, dataBase64, mime } → saves to images/
    if (path === '/api/upload' && req.method === 'POST') {
      const body = (await req.json()) as { filename?: string; dataBase64?: string; mime?: string }
      if (!body.filename || !body.dataBase64) return jsonError(400, 'Missing filename/data')
      const clean = body.filename.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '')
      if (!clean) return jsonError(400, 'Invalid filename')
      const imagesDir = join(requireRoot(), 'images')
      await mkdir(imagesDir, { recursive: true })
      // De-duplicate names (foo.png, foo-1.png, …)
      let name = clean
      let counter = 1
      while (existsSync(join(imagesDir, name))) {
        const dot = clean.lastIndexOf('.')
        const base = dot > 0 ? clean.slice(0, dot) : clean
        const ext = dot > 0 ? clean.slice(dot) : ''
        name = `${base}-${counter}${ext}`
        counter += 1
      }
      const data = Buffer.from(body.dataBase64, 'base64')
      await writeFile(join(imagesDir, name), data)
      return json(200, { path: `images/${name}`, name })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('ENOENT')) return jsonError(404, 'File not found')
    return jsonError(500, message)
  }

  return jsonError(404, 'Not found')
}

function dirnameOf(p: string): string {
  const idx = p.lastIndexOf(sep)
  return idx > 0 ? p.slice(0, idx) : p
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

async function serveStatic(url: URL): Promise<Response> {
  let pathname = decodeURIComponent(url.pathname)
  if (pathname === '/') pathname = '/index.html'

  const filePath = join(DIST_DIR, pathname)
  if (!filePath.startsWith(DIST_DIR)) return new Response('Forbidden', { status: 403 })

  if (existsSync(filePath)) {
    const info = await stat(filePath)
    if (info.isFile()) {
      const ext = extname(filePath).toLowerCase()
      const body = await readFile(filePath)
      return new Response(body, {
        headers: { 'Content-Type': MIME[ext] ?? 'application/octet-stream' },
      })
    }
  }

  // SPA fallback — serve index.html for client-side routes
  const index = join(DIST_DIR, 'index.html')
  if (existsSync(index)) {
    const body = await readFile(index)
    return new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }

  return new Response('Not found — build the editor first (bun run build)', { status: 404 })
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname.startsWith('/api/')) {
      const res = await handleApi(req)
      res.headers.set('Cache-Control', 'no-store')
      return res
    }

    return serveStatic(url)
  },
})

console.log(`[craft] file server listening on http://localhost:${server.port}`)
console.log(`[craft] serving static assets from ${DIST_DIR}`)
if (root) console.log(`[craft] workspace: ${root}`)
