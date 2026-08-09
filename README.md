# Craft — Markdown Editor

A minimal, pure markdown editor with instant (WYSIWYG) rendering, built from
the open-source [craft-agents-oss](https://github.com/craft-ai-agents/craft-agents-oss)
codebase. Everything unrelated to editing has been removed — no agent, no chat,
no server stack. Just a file tree and a live markdown editor.

## Features

- File tree sidebar — open a folder as workspace, create / rename / delete
  files and folders
- Instant-rendering markdown editor (TipTap-based, from the original Craft UI):
  headings, lists, task lists, code blocks with syntax highlighting, LaTeX,
  Mermaid diagrams
- Auto-save (debounced) + `Cmd/Ctrl+S`, save status indicator
- Light / dark theme, word count

## Run

Requires [Bun](https://bun.sh).

```bash
bun install          # inside apps/editor
bun run dev          # file server (8787) + Vite dev server (5173)
```

Then open http://localhost:5173 and enter a folder path to open it as workspace.

Production:

```bash
bun start            # builds the app and serves it on http://localhost:8787
```

## Layout

```
apps/editor/          Vite + React app (the editor UI)
  src/editor/         editor components reused from @craft-agent/ui (markdown subgraph)
  src/components/     file tree, app shell
server/index.ts       Bun file server: static assets + workspace file API
```

## macOS App

A native macOS app (Electron) is included in `apps/desktop` — it embeds the
file server inside the app process, so it runs standalone (no bun needed).

```bash
bun run app:start   # build + launch the app
bun run app:dist    # build + package .dmg / .zip into apps/desktop/dist
```

The packaged app (arm64) installs as **"Craft Markdown"** to avoid colliding
with the existing official Craft app. A prebuilt DMG can be copied from
`apps/desktop/dist/Craft Markdown-0.1.0-arm64.dmg`.

```
apps/desktop/         Electron shell (main.js embeds the file API + serves dist)
```
