import type {
  FleetPi,
  FleetPiHealth,
  FleetResponse,
  GuideIndex,
  OpsApplyResponse,
  OpsApplyTargetRequest,
  OpsCatalogResponse,
  OpsNodeRecord,
  OpsNodesResponse,
  OpsProfilesResponse,
} from '../types'
import {
  NodeRuntimeInputActionSchema,
  OpsNodeCacheClearResponseSchema,
  OpsNodeCacheInspectResponseSchema,
  OpsNodeInputResponseSchema,
  OpsNodeRuntimeStatusResponseSchema,
  type NodeRuntimeInputAction,
  type OpsNodeCacheClearResponse,
  type OpsNodeCacheInspectResponse,
  type OpsNodeInputResponse,
  type OpsNodeRuntimeStatusResponse,
} from '@chiba-cable3/contracts'

async function parseJsonResponseOrThrow<T>(args: {
  res: Response
  schema?: { parse: (value: unknown) => T }
  errorPrefix: string
  maxErrorChars?: number
}): Promise<T> {
  const maxChars = args.maxErrorChars ?? 240
  const raw = await args.res.text().catch(() => '')
  let parsed: unknown = {}
  if (raw) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = { error: raw.slice(0, maxChars) }
    }
  }
  if (!args.res.ok) {
    const detail =
      parsed && typeof parsed === 'object' && parsed !== null && 'error' in parsed
        ? String((parsed as { error?: unknown }).error ?? 'request_failed')
        : raw.slice(0, maxChars)
    throw new Error(`${args.errorPrefix}:${args.res.status}:${detail}`)
  }
  if (args.schema) return args.schema.parse(parsed)
  return parsed as T
}

export async function fetchFleet(signal?: AbortSignal): Promise<FleetResponse> {
  const res = await fetch('/api/ops/fleet', { signal })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`fleet_fetch_failed:${res.status}:${text.slice(0, 120)}`)
  }
  return (await res.json()) as FleetResponse
}

export async function fetchPiHealth(id: string, signal?: AbortSignal): Promise<FleetPiHealth> {
  const qs = new URLSearchParams({ id })
  const res = await fetch(`/api/ops/pi?${qs}`, { signal })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`pi_fetch_failed:${res.status}:${text.slice(0, 120)}`)
  }
  return (await res.json()) as FleetPiHealth
}

export async function fetchProfiles(signal?: AbortSignal): Promise<OpsProfilesResponse> {
  const res = await fetch('/api/ops/profiles', { signal })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`profiles_fetch_failed:${res.status}:${text.slice(0, 120)}`)
  }
  return (await res.json()) as OpsProfilesResponse
}

export async function fetchGuideIndex(signal?: AbortSignal): Promise<GuideIndex> {
  const res = await fetch('/api/index', { signal })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`index_fetch_failed:${res.status}:${text.slice(0, 120)}`)
  }
  return (await res.json()) as GuideIndex
}

export async function fetchCatalog(signal?: AbortSignal): Promise<OpsCatalogResponse> {
  const res = await fetch('/api/ops/catalog', { signal })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`catalog_fetch_failed:${res.status}:${text.slice(0, 240)}`)
  }
  return (await res.json()) as OpsCatalogResponse
}

export async function fetchOpsNodes(signal?: AbortSignal): Promise<OpsNodesResponse> {
  const res = await fetch('/api/ops/nodes', { signal })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`nodes_fetch_failed:${res.status}:${text.slice(0, 240)}`)
  }
  return (await res.json()) as OpsNodesResponse
}

export async function fetchOpsNodeCache(
  nodeId: string,
  signal?: AbortSignal
): Promise<OpsNodeCacheInspectResponse> {
  const id = nodeId.trim()
  if (!id) throw new Error('node_cache_fetch_failed:400:node_id_required')
  const res = await fetch(`/api/ops/nodes/${encodeURIComponent(id)}/cache`, { signal })
  return parseJsonResponseOrThrow({
    res,
    schema: OpsNodeCacheInspectResponseSchema,
    errorPrefix: 'node_cache_fetch_failed',
  })
}

export async function clearOpsNodeCache(nodeId: string): Promise<OpsNodeCacheClearResponse> {
  const id = nodeId.trim()
  if (!id) throw new Error('node_cache_clear_failed:400:node_id_required')
  const res = await fetch(`/api/ops/nodes/${encodeURIComponent(id)}/cache`, {
    method: 'DELETE',
  })
  return parseJsonResponseOrThrow({
    res,
    schema: OpsNodeCacheClearResponseSchema,
    errorPrefix: 'node_cache_clear_failed',
  })
}

export async function fetchOpsNodeRuntimeStatus(
  nodeId: string,
  signal?: AbortSignal
): Promise<OpsNodeRuntimeStatusResponse> {
  const id = nodeId.trim()
  if (!id) throw new Error('node_runtime_status_fetch_failed:400:node_id_required')
  const res = await fetch(`/api/ops/nodes/${encodeURIComponent(id)}/runtime-status`, { signal })
  return parseJsonResponseOrThrow({
    res,
    schema: OpsNodeRuntimeStatusResponseSchema,
    errorPrefix: 'node_runtime_status_fetch_failed',
  })
}

export async function sendOpsNodeInput(
  nodeId: string,
  payload: { action: NodeRuntimeInputAction }
): Promise<OpsNodeInputResponse> {
  const id = nodeId.trim()
  if (!id) throw new Error('node_input_failed:400:node_id_required')
  const action = NodeRuntimeInputActionSchema.parse(payload.action)
  const res = await fetch(`/api/ops/nodes/${encodeURIComponent(id)}/input`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  })
  return parseJsonResponseOrThrow({
    res,
    schema: OpsNodeInputResponseSchema,
    errorPrefix: 'node_input_failed',
  })
}

export async function createOpsNode(
  input: Omit<OpsNodeRecord, 'createdAt' | 'updatedAt' | 'importedAt' | 'connectivity'>
): Promise<{ ok: boolean; registryId: string; node: OpsNodeRecord }> {
  const res = await fetch('/api/ops/nodes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`node_create_failed:${res.status}:${text.slice(0, 240)}`)
  }
  return (await res.json()) as { ok: boolean; registryId: string; node: OpsNodeRecord }
}

export async function updateOpsNode(
  nodeId: string,
  input: Omit<OpsNodeRecord, 'nodeId' | 'createdAt' | 'updatedAt' | 'importedAt' | 'connectivity'>
): Promise<{ ok: boolean; registryId: string; node: OpsNodeRecord }> {
  const res = await fetch(`/api/ops/nodes/${encodeURIComponent(nodeId)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`node_update_failed:${res.status}:${text.slice(0, 240)}`)
  }
  return (await res.json()) as { ok: boolean; registryId: string; node: OpsNodeRecord }
}

export async function deleteOpsNode(nodeId: string): Promise<{ ok: boolean; registryId: string; nodeId: string; deleted: number }> {
  const res = await fetch(`/api/ops/nodes/${encodeURIComponent(nodeId)}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`node_delete_failed:${res.status}:${text.slice(0, 240)}`)
  }
  return (await res.json()) as { ok: boolean; registryId: string; nodeId: string; deleted: number }
}

export async function downloadOpsNodesExport(format: 'json' | 'toml'): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`/api/ops/nodes/export?format=${encodeURIComponent(format)}`)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`nodes_export_failed:${res.status}:${text.slice(0, 240)}`)
  }
  const contentDisposition = res.headers.get('content-disposition') || ''
  const match = /filename=\"?([^\";]+)\"?/i.exec(contentDisposition)
  const filename = match?.[1] || `registry-export.${format}`
  const blob = await res.blob()
  return { blob, filename }
}

export async function applyProfile(opts: { profileId: string; piIds: string[]; dryRun?: boolean }): Promise<OpsApplyResponse> {
  const res = await fetch('/api/ops/apply-profile', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileId: opts.profileId, piIds: opts.piIds, dryRun: opts.dryRun === true }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`apply_profile_failed:${res.status}:${text.slice(0, 240)}`)
  }
  return (await res.json()) as OpsApplyResponse
}

export async function setChannel(opts: {
  channelId: string
  piIds: string[]
  lock?: boolean
  showQr?: boolean
  playlist?: boolean
  nosplash?: boolean
  theme?: string
  dryRun?: boolean
}): Promise<OpsApplyResponse> {
  const res = await fetch('/api/ops/set-channel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      channelId: opts.channelId,
      piIds: opts.piIds,
      lock: opts.lock === true,
      showQr: opts.showQr === true,
      playlist: opts.playlist === true,
      nosplash: opts.nosplash !== false,
      theme: opts.theme,
      dryRun: opts.dryRun === true,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`set_channel_failed:${res.status}:${text.slice(0, 240)}`)
  }
  return (await res.json()) as OpsApplyResponse
}

export async function openProgram(opts: { channelId: string; index: number; piIds: string[]; dryRun?: boolean }): Promise<OpsApplyResponse> {
  const res = await fetch('/api/ops/open-program', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channelId: opts.channelId, index: opts.index, piIds: opts.piIds, dryRun: opts.dryRun === true }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`open_program_failed:${res.status}:${text.slice(0, 240)}`)
  }
  return (await res.json()) as OpsApplyResponse
}

export async function openGuide(opts: {
  piIds: string[]
  lock?: boolean
  showQr?: boolean
  nosplash?: boolean
  dryRun?: boolean
}): Promise<OpsApplyResponse> {
  const res = await fetch('/api/ops/open-guide', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      piIds: opts.piIds,
      lock: opts.lock,
      showQr: opts.showQr,
      nosplash: opts.nosplash,
      dryRun: opts.dryRun === true,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`open_guide_failed:${res.status}:${text.slice(0, 240)}`)
  }
  return (await res.json()) as OpsApplyResponse
}

export async function applyTarget(opts: OpsApplyTargetRequest): Promise<OpsApplyResponse> {
  const res = await fetch('/api/ops/apply-target', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      target: opts.target,
      id: opts.id,
      method: 'state',
      piIds: opts.piIds,
      dryRun: opts.dryRun === true,
      mode: opts.mode,
      targetKind: opts.targetKind,
      targetId: opts.targetId,
      channel: opts.channel,
      lock: opts.lock,
      showQr: opts.showQr,
      playlist: opts.playlist,
      nosplash: opts.nosplash,
      hudMode: opts.hudMode,
      hudShowSec: opts.hudShowSec,
      theme: opts.theme,
      displayRotate: opts.displayRotate,
      scale: opts.scale,
      textScale: opts.textScale,
      hours: opts.hours,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`apply_target_failed:${res.status}:${text.slice(0, 240)}`)
  }
  return (await res.json()) as OpsApplyResponse
}

export type FleetStreamMeta = {
  now: number
  local: { gitSha: string | null; registryPath: string | null }
  pis: FleetPi[]
  probes?: { timeoutMs?: number; concurrency?: number }
}

export function openFleetStream(opts: {
  onMeta: (meta: FleetStreamMeta) => void
  onPi: (pi: FleetPiHealth) => void
  onDone?: () => void
  onError?: (message: string) => void
  timeoutMs?: number
  parallel?: number
}): { close: () => void } {
  const params = new URLSearchParams()
  if (typeof opts.timeoutMs === 'number') params.set('timeoutMs', String(opts.timeoutMs))
  if (typeof opts.parallel === 'number') params.set('parallel', String(opts.parallel))
  const url = `/api/ops/fleet/stream${params.toString() ? `?${params}` : ''}`

  let closed = false
  const es = new EventSource(url)

  const safe = <T extends any[]>(fn: ((...args: T) => void) | undefined, ...args: T) => {
    try {
      fn?.(...args)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[ops] handler failed', e)
    }
  }

  es.addEventListener('meta', (ev) => {
    try {
      const meta = JSON.parse((ev as MessageEvent).data) as FleetStreamMeta
      safe(opts.onMeta, meta)
    } catch (e) {
      safe(opts.onError, `meta_parse_failed:${(e as Error).message}`)
    }
  })

  es.addEventListener('pi', (ev) => {
    try {
      const pi = JSON.parse((ev as MessageEvent).data) as FleetPiHealth
      safe(opts.onPi, pi)
    } catch (e) {
      safe(opts.onError, `pi_parse_failed:${(e as Error).message}`)
    }
  })

  es.addEventListener('done', () => {
    safe(opts.onDone)
    try {
      es.close()
    } catch {}
  })

  es.addEventListener('error', (ev) => {
    // Browser will auto-reconnect; we prefer to surface error and let the caller restart if desired.
    if (closed) return
    // eslint-disable-next-line no-console
    console.warn('[ops] stream error', ev)
    safe(opts.onError, 'stream_error')
  })

  return {
    close: () => {
      closed = true
      try {
        es.close()
      } catch {}
    },
  }
}
