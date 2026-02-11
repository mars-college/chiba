import type { FleetPi, FleetPiHealth, FleetResponse, GuideIndex, OpsApplyResponse, OpsCatalogResponse, OpsProfilesResponse } from '../types'

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
