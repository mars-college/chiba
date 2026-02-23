export type C3Media = {
  id: string
  title?: string
  artist?: string
  description?: string
  sourceType: 'path' | 'url'
  sourceValue: string
  cache: boolean
}

export type C3PlaylistItem = {
  index: number
  mediaId?: string
  playlistId?: string
  durationSec?: number
}

export type C3Playlist = {
  id: string
  title?: string
  artist?: string
  description?: string
  items: C3PlaylistItem[]
}

export type C3BlockItem = {
  index: number
  mediaId?: string
  playlistId?: string
  durationSec?: number
}

export type C3Block = {
  id: string
  title?: string
  mode?: 'loop' | 'once' | 'clocked'
  items: C3BlockItem[]
}

export type C3Channel = {
  id: string
  number?: string
  name?: string
  blockIds: string[]
}

export type C3ProfileNode = {
  nodeId: string
  target: {
    kind: 'media' | 'playlist' | 'block' | 'channel' | 'profile'
    id: string
  }
  launch: Record<string, unknown>
}

export type C3Profile = {
  id: string
  title?: string
  defaults: Record<string, unknown>
  defaultTarget?: {
    kind: 'media' | 'playlist' | 'block' | 'channel' | 'profile'
    id: string
  }
  nodes: C3ProfileNode[]
}

export type C3ResourcePayload = {
  media: C3Media[]
  playlists: C3Playlist[]
  blocks: C3Block[]
  channels: C3Channel[]
  profiles: C3Profile[]
}

export async function importC3Resources(payload: C3ResourcePayload): Promise<{
  ok: boolean
  counts: {
    media: number
    playlists: number
    blocks: number
    channels: number
    profiles: number
  }
}> {
  const res = await fetch('/api/c3/v1/resources/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`c3_import_failed:${res.status}:${text.slice(0, 240)}`)
  }
  return (await res.json()) as {
    ok: boolean
    counts: {
      media: number
      playlists: number
      blocks: number
      channels: number
      profiles: number
    }
  }
}

export async function fetchC3Snapshot(): Promise<{ ok: boolean; snapshot: C3ResourcePayload }> {
  const res = await fetch('/api/c3/v1/resources/snapshot')
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`c3_snapshot_failed:${res.status}:${text.slice(0, 240)}`)
  }
  return (await res.json()) as { ok: boolean; snapshot: C3ResourcePayload }
}

