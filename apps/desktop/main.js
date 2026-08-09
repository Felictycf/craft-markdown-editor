/**
 * Craft — macOS desktop app (Electron)
 *
 * A zero-extra-dependency wrapper: the main process embeds a small Node HTTP
 * server (same API as server/index.ts) that serves the built editor bundle
 * from ../editor/dist and the workspace file API. The BrowserWindow loads
 * http://127.0.0.1:<port> so the renderer code stays identical to the
 * browser version.
 */

const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron')
const http = require('node:http')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { homedir } = require('node:os')

const DIST_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'editor-dist')
  : path.join(__dirname, '..', 'editor', 'dist')

const STATE_DIR = path.join(homedir(), '.craft-editor')
const STATE_FILE = path.join(STATE_DIR, 'state.json')
const MAX_TREE_DEPTH = 12
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.cache', '.next', '.vite', '.svelte-kit', '.turbo'])

let root = loadState()

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    return typeof parsed.root === 'string' && parsed.root.length > 0 ? parsed.root : null
  } catch {
    return null
  }
}

function persistState() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true })
    fs.writeFileSync(STATE_FILE, JSON.stringify({ root }, null, 2))
  } catch (err) {
    console.error('[craft] failed to persist state:', err)
  }
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

function requireRoot() {
  if (!root) throw new Error('No workspace open')
  return root
}

function safeResolve(rel) {
  const base = requireRoot()
  const abs = path.resolve(base, rel)
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    throw new Error('Path escapes workspace')
  }
  return abs
}

function dirnameOf(p) {
  const idx = p.lastIndexOf(path.sep)
  return idx > 0 ? p.slice(0, idx) : p
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

const ORDER_FILE = '.craft-order.json'

async function loadOrder() {
  try {
    const raw = await fsp.readFile(path.join(requireRoot(), ORDER_FILE), 'utf8')
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

async function saveOrder(order) {
  await fsp.writeFile(path.join(requireRoot(), ORDER_FILE), JSON.stringify(order, null, 2), 'utf8')
}

async function buildTree(dir, depth) {
  if (depth > MAX_TREE_DEPTH) return []
  const entries = await fsp.readdir(dir, { withFileTypes: true })
  const rel = dir === requireRoot() ? '' : dir.slice(requireRoot().length + 1).split(path.sep).join('/')
  const orderMap = await loadOrder()
  const ordered = orderMap[rel] ?? []
  const orderIndex = new Map(ordered.map((name, i) => [name, i]))
  entries.sort((a, b) => {
    const ad = a.isDirectory() ? 0 : 1
    const bd = b.isDirectory() ? 0 : 1
    if (ad !== bd) return ad - bd
    const ia = orderIndex.get(a.name)
    const ib = orderIndex.get(b.name)
    if (ia !== undefined && ib !== undefined) return ia - ib
    if (ia !== undefined) return -1
    if (ib !== undefined) return 1
    return a.name.localeCompare(b.name)
  })

  const nodes = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
    const abs = path.join(dir, entry.name)
    const childRel = abs.slice(requireRoot().length + 1).split(path.sep).join('/')
    if (entry.isDirectory()) {
      nodes.push({ name: entry.name, path: childRel, type: 'folder', children: await buildTree(abs, depth + 1) })
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      nodes.push({
        name: entry.name,
        path: childRel,
        type: 'file',
        editable: ext === '.md' || ext === '.markdown',
      })
    }
  }
  return nodes
}

// ---------------------------------------------------------------------------
// HTTP server (node http — same routes as server/index.ts)
// ---------------------------------------------------------------------------

const MIME = {
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

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

async function handleApi(req, res, url) {
  try {
    if (url.pathname === '/api/state' && req.method === 'GET') {
      return json(res, 200, { root, name: root ? path.basename(root) : '' })
    }

    if (url.pathname === '/api/workspace' && req.method === 'POST') {
      const body = await readBody(req)
      const candidate = (body.root ?? '').trim()
      if (!candidate) return json(res, 400, { error: 'Missing root path' })
      const resolved = path.resolve(candidate)
      let info
      try {
        info = await fsp.stat(resolved)
      } catch {
        return json(res, 400, { error: `Folder does not exist: ${candidate}` })
      }
      if (!info.isDirectory()) return json(res, 400, { error: `Not a folder: ${candidate}` })
      root = resolved
      persistState()
      return json(res, 200, { root, name: path.basename(root) })
    }

    if (url.pathname === '/api/tree' && req.method === 'GET') {
      requireRoot()
      return json(res, 200, await buildTree(root, 0))
    }

    if (url.pathname === '/api/file' && req.method === 'GET') {
      const rel = url.searchParams.get('path')
      if (!rel) return json(res, 400, { error: 'Missing path' })
      const content = await fsp.readFile(safeResolve(rel), 'utf8')
      return json(res, 200, { content })
    }

    if (url.pathname === '/api/file' && req.method === 'POST') {
      const body = await readBody(req)
      if (!body.path) return json(res, 400, { error: 'Missing path' })
      const abs = safeResolve(body.path)
      await fsp.mkdir(dirnameOf(abs), { recursive: true })
      await fsp.writeFile(abs, body.content ?? '', 'utf8')
      return json(res, 200, { ok: true })
    }

    if (url.pathname === '/api/entry' && req.method === 'POST') {
      const body = await readBody(req)
      if (!body.path) return json(res, 400, { error: 'Missing path' })
      if (body.type !== 'file' && body.type !== 'folder') return json(res, 400, { error: 'Invalid type' })
      const abs = safeResolve(body.path)
      await fsp.mkdir(dirnameOf(abs), { recursive: true })
      if (body.type === 'folder') await fsp.mkdir(abs, { recursive: true })
      else await fsp.writeFile(abs, '', 'utf8')
      return json(res, 200, { ok: true })
    }

    if (url.pathname === '/api/entry' && req.method === 'DELETE') {
      const rel = url.searchParams.get('path')
      if (!rel) return json(res, 400, { error: 'Missing path' })
      await fsp.rm(safeResolve(rel), { recursive: true, force: true })
      return json(res, 200, { ok: true })
    }

    if (url.pathname === '/api/rename' && req.method === 'POST') {
      const body = await readBody(req)
      if (!body.from || !body.to) return json(res, 400, { error: 'Missing from/to' })
      const toAbs = safeResolve(body.to)
      await fsp.mkdir(dirnameOf(toAbs), { recursive: true })
      await fsp.rename(safeResolve(body.from), toAbs)
      return json(res, 200, { ok: true })
    }

    // --- move (drag & drop in the file tree) ------------------------------
    if (url.pathname === '/api/move' && req.method === 'POST') {
      const body = await readBody(req)
      if (!body.from) return json(res, 400, { error: 'Missing from' })
      const fromAbs = safeResolve(body.from)
      const dirAbs = safeResolve(body.toDir ?? '')
      if (body.toDir) {
        const dirInfo = await fsp.stat(dirAbs)
        if (!dirInfo.isDirectory()) return json(res, 400, { error: 'Target is not a folder' })
      } else if (dirnameOf(fromAbs) === requireRoot() && !body.anchor) {
        return json(res, 200, { ok: true, to: body.from })
      }
      if (fromAbs === dirAbs || dirAbs.startsWith(fromAbs + path.sep)) {
        return json(res, 400, { error: 'Cannot move into itself' })
      }
      const name = path.basename(fromAbs)
      const target = path.join(dirAbs, name)
      if (target !== fromAbs && fs.existsSync(target)) {
        return json(res, 400, { error: `Already exists: ${name}` })
      }
      if (target !== fromAbs) await fsp.rename(fromAbs, target)
      const rel = target.slice(requireRoot().length + 1).split(path.sep).join('/')

      const dirKey = body.toDir ? String(body.toDir).split(path.sep).join('/') : ''
      const order = await loadOrder()
      const list = (order[dirKey] ?? []).filter((n) => n !== name)
      {
        const dirEntries = await fsp.readdir(dirAbs, { withFileTypes: true })
        const missing = dirEntries
          .filter((en) => !en.name.startsWith('.') && !SKIP_DIRS.has(en.name) && !list.includes(en.name))
          .map((en) => en.name)
          .sort((a, b) => a.localeCompare(b))
        list.push(...missing)
      }
      if (body.anchor && body.anchor !== name) {
        const idx = list.indexOf(String(body.anchor))
        const insertAt = idx === -1 ? list.length : body.before ? idx : idx + 1
        list.splice(insertAt, 0, name)
      } else {
        list.push(name)
      }
      order[dirKey] = list
      await saveOrder(order)

      return json(res, 200, { ok: true, to: rel })
    }

    // --- global search across the workspace --------------------------------
    if (url.pathname === '/api/search' && req.method === 'GET') {
      const q = (url.searchParams.get('q') ?? '').trim()
      if (!q) return json(res, 400, { error: 'Missing query' })
      const needle = q.toLowerCase()
      const results = []

      const walk = async (dir) => {
        const entries = await fsp.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
          const abs = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            await walk(abs)
            continue
          }
          const ext = path.extname(entry.name).toLowerCase()
          if (ext !== '.md' && ext !== '.markdown') continue
          const rel = abs.slice(requireRoot().length + 1).split(path.sep).join('/')
          let text
          try {
            text = await fsp.readFile(abs, 'utf8')
          } catch {
            continue
          }
          const matches = []
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
      return json(res, 200, { results })
    }

    // --- workspace assets (images referenced from markdown) --------------
    if (url.pathname === '/api/assets' && req.method === 'GET') {
      const rel = url.searchParams.get('path')
      if (!rel) return json(res, 400, { error: 'Missing path' })
      const abs = safeResolve(rel)
      const info = await fsp.stat(abs)
      if (!info.isFile()) return json(res, 404, { error: 'Not a file' })
      const ext = path.extname(abs).toLowerCase()
      const body = await fsp.readFile(abs)
      res.writeHead(200, {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
      })
      res.end(body)
      return
    }

    // --- image upload (paste/drop into the editor) -----------------------
    if (url.pathname === '/api/upload' && req.method === 'POST') {
      const body = await readBody(req)
      if (!body.filename || !body.dataBase64) return json(res, 400, { error: 'Missing filename/data' })
      const clean = String(body.filename).replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '')
      if (!clean) return json(res, 400, { error: 'Invalid filename' })
      const imagesDir = path.join(requireRoot(), 'images')
      await fsp.mkdir(imagesDir, { recursive: true })
      let name = clean
      let counter = 1
      while (fs.existsSync(path.join(imagesDir, name))) {
        const dot = clean.lastIndexOf('.')
        const base = dot > 0 ? clean.slice(0, dot) : clean
        const ext = dot > 0 ? clean.slice(dot) : ''
        name = `${base}-${counter}${ext}`
        counter += 1
      }
      const data = Buffer.from(body.dataBase64, 'base64')
      await fsp.writeFile(path.join(imagesDir, name), data)
      return json(res, 200, { path: `images/${name}`, name })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('ENOENT')) return json(res, 404, { error: 'File not found' })
    return json(res, 500, { error: message })
  }

  return json(res, 404, { error: 'Not found' })
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname)
  if (pathname === '/') pathname = '/index.html'

  const filePath = path.join(DIST_DIR, pathname)
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403).end('Forbidden')
    return
  }

  if (fs.existsSync(filePath)) {
    const info = await fsp.stat(filePath)
    if (info.isFile()) {
      const ext = path.extname(filePath).toLowerCase()
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' })
      fs.createReadStream(filePath).pipe(res)
      return
    }
  }

  const index = path.join(DIST_DIR, 'index.html')
  if (fs.existsSync(index)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    fs.createReadStream(index).pipe(res)
    return
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('Not found — build the editor first: cd apps/editor && bun run build')
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url)
    return serveStatic(req, res, url)
  })
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let server = null
let mainWindow = null

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 760,
    minHeight: 500,
    title: 'Craft — Markdown Editor',
    backgroundColor: '#f8f7fa',
    icon: path.join(__dirname, 'resources', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  mainWindow.setMenuBarVisibility(false)
  mainWindow.loadURL(`http://127.0.0.1:${port}`)

  // Self-test hook: CRAFT_SCREENSHOT=/path.png → capture window after load and quit.
  if (process.env.CRAFT_SCREENSHOT) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const bridge = await mainWindow.webContents.executeJavaScript(
            'JSON.stringify({ craft: typeof window.craft, openDir: typeof window.craft?.openDirectoryDialog })'
          )
          console.log('[craft] bridge:', bridge)
          // Open the "Open folder" dialog so the screenshot shows the Browse… button
          await mainWindow.webContents.executeJavaScript(
            `document.querySelector('[title="Open another folder"]')?.click()`
          )
          await new Promise((resolve) => setTimeout(resolve, 800))
          const dialogDom = await mainWindow.webContents.executeJavaScript(
            `JSON.stringify({ dialog: !!document.querySelector('.fixed.inset-0'), browseBtn: !!document.querySelector('button[title="Browse…"]') })`
          )
          console.log('[craft] dialog dom:', dialogDom)
          const image = await mainWindow.webContents.capturePage()
          fs.writeFileSync(process.env.CRAFT_SCREENSHOT, image.toPNG())
          console.log('[craft] screenshot saved:', process.env.CRAFT_SCREENSHOT)
        } catch (err) {
          console.error('[craft] screenshot failed:', err)
        } finally {
          app.exit(0)
        }
      }, 4000)
    })
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  buildMenu()

  ipcMain.handle('craft:openDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title: 'Open Folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  server = createServer()
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port
    console.log(`[craft] file server on http://127.0.0.1:${port}`)
    if (root) console.log(`[craft] workspace: ${root}`)
    createWindow(port)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && server) {
      createWindow(server.address().port)
    }
  })
})

/**
 * Self-test: CRAFT_DRAG_TEST="srcText|dstText" drives a REAL drag & drop
 * through the Chrome DevTools Protocol (same sequence Playwright uses),
 * which Chromium recognizes as a genuine HTML5 drag.
 */
async function runDragTest() {
  const spec = process.env.CRAFT_DRAG_TEST || ''
  const [srcText, dstText] = spec.split('|')
  const wc = mainWindow.webContents
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const send = (method, params) => wc.debugger.sendCommand(method, params)

  try {
    wc.debugger.attach('1.3')
    await wait(2000)

    // Log which drag events actually fire in the page
    await wc.executeJavaScript(`
      window.__dragLog = [];
      ['dragstart','dragenter','dragover','dragleave','drop','dragend'].forEach(t =>
        document.addEventListener(t, e => window.__dragLog.push(t + '@' + (e.target.closest ? (e.target.closest('[role=treeitem]')?.textContent.slice(0,12) || 'bg') : '?')), true)
      );
    `)

    // Expand docs folder so its children are visible
    await wc.executeJavaScript(
      `Array.from(document.querySelectorAll('[role=treeitem]')).find(el => el.textContent.includes('docs'))?.click()`
    )
    await wait(600)

    const rects = await wc.executeJavaScript(`(() => {
      const rows = Array.from(document.querySelectorAll('[role=treeitem]'));
      const src = rows.find(el => el.getAttribute('data-name') === ${JSON.stringify(srcText)});
      const dst = rows.find(el => el.getAttribute('data-name') === ${JSON.stringify(dstText)});
      if (!src || !dst) return null;
      const s = src.getBoundingClientRect();
      const d = dst.getBoundingClientRect();
      return { sx: s.x + s.width / 2, sy: s.y + s.height / 2, dx: d.x + 15, dy: d.y + d.height * 0.8 };
    })()`)
    if (!rects) {
      console.log('[craft] drag test: rows not found')
      return
    }

    // Playwright-style sequence:
    // 1) hover source, press, move with button held (starts the drag)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rects.sx, y: rects.sy })
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: rects.sx, y: rects.sy, button: 'left', buttons: 1, clickCount: 1,
    })
    for (let i = 1; i <= 8; i++) {
      const x = rects.sx + ((rects.dx - rects.sx) * i) / 8
      const y = rects.sy + ((rects.dy - rects.sy) * i) / 8
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x, y, button: 'left', buttons: 1,
      })
      await wait(40)
    }
    // 2) dragEnter/dragOver with empty drag data (payload travels via our ref)
    const dragData = { items: [], dragOperationsMask: 1 }
    await send('Input.dispatchDragEvent', { type: 'dragEnter', x: rects.dx, y: rects.dy, data: dragData })
    await send('Input.dispatchDragEvent', { type: 'dragOver', x: rects.dx, y: rects.dy, data: dragData })
    await wait(200)
    // 3) drop via mouse release
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: rects.dx, y: rects.dy, button: 'left', clickCount: 1,
    })
    await wait(2000)

    const dragLog = await wc.executeJavaScript('window.__dragLog ? window.__dragLog.join(" | ") : "no log"')
    console.log('[craft] drag events:', dragLog)

    const result = await wc.executeJavaScript(`fetch('/api/tree').then(r => r.json()).then(d => {
      const names = [];
      const walk = (nodes) => nodes.forEach(n => { names.push(n.path); if (n.children) walk(n.children); });
      walk(d);
      return names.join(',');
    })`)
    console.log('[craft] drag test paths:', result)

    const img = await wc.capturePage()
    fs.writeFileSync('/tmp/craft-drag-test.png', img.toPNG())
    console.log('[craft] drag test screenshot saved')
  } catch (err) {
    console.error('[craft] drag test failed:', err)
  } finally {
    try { wc.debugger.detach() } catch {}
    app.exit(0)
  }
}

if (process.env.CRAFT_DRAG_TEST) {
  app.whenReady().then(() => {
    setTimeout(() => {
      if (mainWindow) void runDragTest()
    }, 1500)
  })
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  if (server) {
    server.close()
    server = null
  }
})
