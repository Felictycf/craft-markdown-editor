/**
 * API client for the Craft editor file server.
 * All paths are relative to the workspace root (POSIX-style).
 */

export interface WorkspaceInfo {
  root: string
  name: string
}

export interface TreeNode {
  name: string
  path: string
  type: 'file' | 'folder'
  children?: TreeNode[]
  editable?: boolean
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch {
      // keep status text
    }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

export function getWorkspace(): Promise<WorkspaceInfo | null> {
  return request<WorkspaceInfo | null>('/api/state')
}

export function setWorkspace(root: string): Promise<WorkspaceInfo> {
  return request<WorkspaceInfo>('/api/workspace', {
    method: 'POST',
    body: JSON.stringify({ root }),
  })
}

export function getTree(): Promise<TreeNode[]> {
  return request<TreeNode[]>('/api/tree')
}

export function getFile(path: string): Promise<{ content: string }> {
  return request<{ content: string }>(`/api/file?path=${encodeURIComponent(path)}`)
}

export function saveFile(path: string, content: string): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/file', {
    method: 'POST',
    body: JSON.stringify({ path, content }),
  })
}

export function createEntry(path: string, type: 'file' | 'folder'): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/entry', {
    method: 'POST',
    body: JSON.stringify({ path, type }),
  })
}

export function deleteEntry(path: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/entry?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
  })
}

export function renameEntry(from: string, to: string): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/rename', {
    method: 'POST',
    body: JSON.stringify({ from, to }),
  })
}
