import { useEffect, useMemo, useRef, useState } from 'react'
import { applyProfile, fetchCatalog, fetchFleet, fetchGuideIndex, fetchPiHealth, fetchProfiles, openFleetStream, openGuide, openProgram, setChannel, type FleetStreamMeta } from './lib/api'
import type { FleetPi, FleetPiHealth, GuideIndex, OpsProfile } from './types'

function fmtAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h`
}

function Pill({ kind, label }: { kind: 'ok' | 'warn' | 'bad' | 'muted'; label: string }) {
  return <span className={`pill pill-${kind}`}>{label}</span>
}

function rowKind(pi: FleetPi | FleetPiHealth | null): 'ok' | 'warn' | 'bad' | 'muted' {
  if (!pi) return 'muted'
  // Registry can contain external/unaddressable nodes with host="".
  // When static IPs are configured, `ip` may be present even if `host` is empty.
  const addr = (pi as any).ip || (pi as any).host
  if (!addr) return 'muted'
  if (!('dnsOk' in pi)) return 'muted'
  if (!pi.dnsOk) return 'bad'
  const anyTcpOk = pi.tcp.ssh22.ok || pi.tcp.node8080.ok || pi.tcp.cable8787.ok
  if (!anyTcpOk && !pi.ping.ok) return 'bad'
  if (pi.needsUpdate === true) return 'warn'
  return 'ok'
}

export default function App() {
  const [view, setView] = useState<'fleet' | 'catalog'>('fleet')
  const [meta, setMeta] = useState<FleetStreamMeta | null>(null)
  const [healthById, setHealthById] = useState<Record<string, FleetPiHealth>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [filter, setFilter] = useState<'all' | 'bad' | 'warn' | 'ok'>('all')
  const [checkingById, setCheckingById] = useState<Record<string, boolean>>({})
  const [profiles, setProfiles] = useState<OpsProfile[]>([])
  const [guideIndex, setGuideIndex] = useState<GuideIndex | null>(null)
  const [selectedById, setSelectedById] = useState<Record<string, boolean>>({})
  const [profileId, setProfileId] = useState<string>('')
  const [channelId, setChannelId] = useState<string>('')
  const [channelLock, setChannelLock] = useState(false)
  const [channelShowQr, setChannelShowQr] = useState(false)
  const [channelPlaylist, setChannelPlaylist] = useState(false)
  const [programChannelId, setProgramChannelId] = useState<string>('')
  const [programIndex, setProgramIndex] = useState(0)
  const [controlBusy, setControlBusy] = useState(false)
  const [controlMsg, setControlMsg] = useState<string | null>(null)
  const [controlErr, setControlErr] = useState<string | null>(null)
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({})
  const [catalog, setCatalog] = useState<any | null>(null)
  const [catalogErr, setCatalogErr] = useState<string | null>(null)
  const [catalogTab, setCatalogTab] = useState<'channels' | 'blocks' | 'playlists' | 'media'>('channels')
  const [catalogFilter, setCatalogFilter] = useState<string>('')
  const abortRef = useRef<AbortController | null>(null)
  const streamRef = useRef<{ close: () => void } | null>(null)

  const toggleExpanded = (id: string) => {
    setExpandedById((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const closeStream = () => {
    streamRef.current?.close()
    streamRef.current = null
  }

  const startStream = (opts?: { reset?: boolean }) => {
    closeStream()
    setLoading(true)
    setError(null)
    if (opts?.reset !== false) setHealthById({})
    streamRef.current = openFleetStream({
      // You can tune these without redeploying:
      // timeoutMs: 650,
      // parallel: 12,
      onMeta: (m) => {
        setMeta(m)
        setLoading(false)
      },
      onPi: (pi) => {
        setHealthById((prev) => (prev[pi.id] === pi ? prev : { ...prev, [pi.id]: pi }))
      },
      onDone: () => {
        // no-op; keep last results on screen
      },
      onError: (msg) => {
        setError(msg)
      },
    })
  }

  // Fallback for environments where SSE is blocked.
  const loadSnapshot = async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setLoading(true)
    setError(null)
    try {
      const res = await fetchFleet(ac.signal)
      setMeta({ now: res.now, local: res.local, pis: res.pis })
      const map: Record<string, FleetPiHealth> = {}
      for (const pi of res.pis) map[pi.id] = pi
      setHealthById(map)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const refreshOne = async (id: string) => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setError(null)
    setCheckingById((prev) => ({ ...prev, [id]: true }))
    try {
      const health = await fetchPiHealth(id, ac.signal)
      setHealthById((prev) => ({ ...prev, [id]: health }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCheckingById((prev) => ({ ...prev, [id]: false }))
    }
  }

  const loadCatalog = async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setCatalogErr(null)
    try {
      const res = await fetchCatalog(ac.signal)
      if (!(res as any)?.ok) {
        setCatalogErr((res as any)?.error ?? 'catalog_failed')
        return
      }
      setCatalog(res)
    } catch (e) {
      setCatalogErr((e as Error).message)
    }
  }

  useEffect(() => {
    startStream({ reset: true })
    return () => {
      closeStream()
      abortRef.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (view !== 'catalog') return
    if (catalog) return
    void loadCatalog()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  // Load catalog opportunistically so the Fleet row details can resolve
  // channel -> blocks -> playlists -> media without switching views.
  useEffect(() => {
    if (catalog || catalogErr) return
    const ac = new AbortController()
    ;(async () => {
      try {
        const res = await fetchCatalog(ac.signal)
        if ((res as any)?.ok) setCatalog(res)
      } catch {
        // ignore
      }
    })()
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Load static-ish ops data once (profiles + channel index).
    const ac = new AbortController()
    ;(async () => {
      try {
        const [p, idx] = await Promise.all([fetchProfiles(ac.signal), fetchGuideIndex(ac.signal)])
        setProfiles(p.profiles ?? [])
        setGuideIndex(idx)
        if (!profileId && p.profiles?.length) setProfileId(p.profiles[0].id)
        const firstChannel = idx.channels?.find((c) => c.id)?.id ?? ''
        if (!channelId && firstChannel) setChannelId(firstChannel)
        if (!programChannelId && firstChannel) setProgramChannelId(firstChannel)
      } catch (e) {
        // Don't block fleet health UI if these fail.
        // eslint-disable-next-line no-console
        console.warn('[ops] preload failed', e)
      }
    })()
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!autoRefresh) return
    const t = window.setInterval(() => {
      startStream({ reset: false })
    }, 8000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh])

  const rows = useMemo(() => {
    const base = meta?.pis ?? []
    const joined = base.map((p) => healthById[p.id] ?? p)
    const filtered = joined.filter((pi) => {
      const kind = rowKind(pi as any)
      if (filter === 'all') return true
      if (filter === 'bad') return kind === 'bad'
      if (filter === 'warn') return kind === 'warn'
      return kind === 'ok'
    })
    filtered.sort((a, b) => {
      const ka = rowKind(a as any)
      const kb = rowKind(b as any)
      const rank = (k: string) => (k === 'bad' ? 0 : k === 'warn' ? 1 : k === 'muted' ? 3 : 2)
      const r = rank(ka) - rank(kb)
      if (r !== 0) return r
      return a.id.localeCompare(b.id)
    })
    return filtered
  }, [meta, healthById, filter])

  const now = meta?.now ?? Date.now()
  const selectedIds = useMemo(
    () => Object.entries(selectedById).filter(([, v]) => v).map(([k]) => k),
    [selectedById]
  )

  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows])

  const allChannels = useMemo(() => guideIndex?.channels ?? [], [guideIndex])
  const channelOptions = useMemo(() => {
    const items = allChannels
      .map((c) => {
        const labelBits = [c.number ? String(c.number).trim() : '', c.name ? String(c.name).trim() : '', c.id]
          .filter(Boolean)
          .join(' ')
        return { id: c.id, label: labelBits }
      })
      .sort((a, b) => a.label.localeCompare(b.label))
    return items
  }, [allChannels])

  const programOptions = useMemo(() => {
    const ch = allChannels.find((c) => c.id === programChannelId)
    const artItems = (ch?.schedule ?? []).filter((s) => Boolean(s.url))
    return artItems.map((slot, i) => ({
      i,
      label: `${String(i).padStart(2, '0')}  ${slot.title ?? 'Untitled'}${slot.subtitle ? `  (${slot.subtitle})` : ''}`,
      url: slot.url ?? '',
    }))
  }, [allChannels, programChannelId])

  const summarizeResults = (results: Array<{ ok: boolean; id: string; error?: string | null }>) => {
    const ok = results.filter((r) => r.ok).length
    const bad = results.length - ok
    if (!results.length) return 'No targets.'
    if (bad === 0) return `Applied to ${ok}/${results.length}.`
    const firstErr = results.find((r) => !r.ok)?.error ?? 'unknown_error'
    return `Applied to ${ok}/${results.length}. Failures: ${bad}. First error: ${firstErr}`
  }

  const runApply = async (fn: () => Promise<{ ok: boolean; results: Array<{ id: string; ok: boolean; error: string | null }> }>) => {
    if (!selectedIds.length) {
      setControlErr('Select at least one node.')
      return
    }
    setControlBusy(true)
    setControlErr(null)
    setControlMsg(null)
    try {
      const res = await fn()
      if (!res.ok) {
        setControlErr('request_failed')
        return
      }
      setControlMsg(summarizeResults(res.results))
      // Refresh health so the table reflects new kiosk urls quickly.
      startStream({ reset: false })
    } catch (e) {
      setControlErr((e as Error).message)
    } finally {
      setControlBusy(false)
    }
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand">
            <div className="brand-mark" aria-hidden />
            <div className="brand-text">
              <div className="brand-title">CHIBA</div>
              <div className="brand-subtitle">CABLE OPS</div>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button className={`nav-btn ${view === 'fleet' && filter === 'all' ? 'active' : ''}`} onClick={() => { setView('fleet'); setFilter('all') }}>
            Fleet
          </button>
          <button className={`nav-btn ${view === 'fleet' && filter === 'bad' ? 'active' : ''}`} onClick={() => { setView('fleet'); setFilter('bad') }}>
            Offline
          </button>
          <button className={`nav-btn ${view === 'fleet' && filter === 'warn' ? 'active' : ''}`} onClick={() => { setView('fleet'); setFilter('warn') }}>
            Needs Update
          </button>
          <button className={`nav-btn ${view === 'fleet' && filter === 'ok' ? 'active' : ''}`} onClick={() => { setView('fleet'); setFilter('ok') }}>
            Healthy
          </button>
          <button className={`nav-btn ${view === 'catalog' ? 'active' : ''}`} onClick={() => setView('catalog')}>
            Catalog
          </button>
        </nav>

        <div className="sidebar-footer">
          <div>registry: {meta?.local.registryPath ?? 'not set'}</div>
          <div>local git: {meta?.local.gitSha ?? 'unknown'}</div>
        </div>
      </aside>

      <main className="main-content">
        {view === 'catalog' ? (
          <>
            <div className="page-header">
              <div className="page-header-row">
                <div>
                  <h1 className="page-title">Config Catalog</h1>
                  <div className="page-subtitle">media, playlists, blocks, channels (from the cable server)</div>
                </div>
                <div className="actions">
                  <button className="btn" onClick={() => { setCatalog(null); void loadCatalog() }}>
                    Refresh
                  </button>
                </div>
              </div>
              {catalogErr ? <div className="alert alert-error">Catalog: {catalogErr}</div> : null}
            </div>

            <div className="card control-card">
              <div className="card-header">
                <div className="card-title">Browse</div>
                <div className="card-meta">
                  {catalog?.counts ? (
                    <span className="mono">
                      ch {catalog.counts.channels} | blk {catalog.counts.blocks} | pl {catalog.counts.playlists} | media {catalog.counts.media}
                    </span>
                  ) : (
                    <span className="muted">loading…</span>
                  )}
                </div>
              </div>
              <div className="control-body">
                <div className="control-row">
                  <button className={`btn btn-small ${catalogTab === 'channels' ? 'active' : ''}`} onClick={() => setCatalogTab('channels')}>Channels</button>
                  <button className={`btn btn-small ${catalogTab === 'blocks' ? 'active' : ''}`} onClick={() => setCatalogTab('blocks')}>Blocks</button>
                  <button className={`btn btn-small ${catalogTab === 'playlists' ? 'active' : ''}`} onClick={() => setCatalogTab('playlists')}>Playlists</button>
                  <button className={`btn btn-small ${catalogTab === 'media' ? 'active' : ''}`} onClick={() => setCatalogTab('media')}>Media</button>
                  <input className="input" placeholder="filter by id/title…" value={catalogFilter} onChange={(e) => setCatalogFilter(e.target.value)} />
                </div>

                {(() => {
                  const items: any[] = Array.isArray((catalog as any)?.[catalogTab]) ? (catalog as any)[catalogTab] : []
                  const q = catalogFilter.trim().toLowerCase()
                  const filtered = q
                    ? items.filter((it) => {
                        const id = String(it?.id ?? '').toLowerCase()
                        const title = String(it?.title ?? it?.name ?? '').toLowerCase()
                        return id.includes(q) || title.includes(q)
                      })
                    : items

                  return (
                    <div className="catalog-list">
                      {filtered.map((it) => (
                        <details key={String(it?.id ?? Math.random())} className="catalog-item">
                          <summary>
                            <span className="mono">{String(it?.id ?? '(no id)')}</span>
                            {it?.title || it?.name ? <span className="muted"> {String(it.title ?? it.name)}</span> : null}
                          </summary>
                          <pre className="catalog-pre">{JSON.stringify(it, null, 2)}</pre>
                        </details>
                      ))}
                      {!filtered.length ? <div className="muted">No items.</div> : null}
                    </div>
                  )
                })()}
              </div>
            </div>
          </>
        ) : (
        <>
        <div className="page-header">
          <div className="page-header-row">
            <div>
              <h1 className="page-title">Fleet Health</h1>
              <div className="page-subtitle">Active probes: addr (static IP preferred), ping (best effort), TCP(22/8080/8787), HTTP(/status, /api/version)</div>
            </div>
            <div className="actions">
              <label className="toggle">
                <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
                <span>Auto refresh (all)</span>
              </label>
              <button className="btn" onClick={() => startStream({ reset: false })} disabled={loading}>
                Refresh all
              </button>
              <button className="btn" onClick={() => loadSnapshot()} disabled={loading}>
                Snapshot
              </button>
            </div>
          </div>

          {error ? (
            <div className="alert alert-error">Error: {error}</div>
          ) : null}
          {controlErr ? (
            <div className="alert alert-error">Control: {controlErr}</div>
          ) : null}
          {controlMsg ? (
            <div className="alert">Control: {controlMsg}</div>
          ) : null}
        </div>

        <div className="card control-card">
          <div className="card-header">
            <div className="card-title">Control</div>
            <div className="card-meta">
              Selected: <span className="mono">{selectedIds.length}</span> / visible: <span className="mono">{visibleIds.length}</span>
            </div>
          </div>
          <div className="control-body">
            <div className="control-row">
              <button
                className="btn btn-small"
                onClick={() => {
                  const next: Record<string, boolean> = {}
                  for (const id of visibleIds) next[id] = true
                  setSelectedById(next)
                }}
                disabled={controlBusy || loading || !visibleIds.length}
              >
                Select visible
              </button>
              <button className="btn btn-small" onClick={() => setSelectedById({})} disabled={controlBusy || loading}>
                Clear
              </button>
            </div>

            <div className="control-grid">
              <div className="control-block">
                <div className="control-title">Apply Profile</div>
                <div className="control-fields">
                  <select className="input" value={profileId} onChange={(e) => setProfileId(e.target.value)} disabled={controlBusy}>
                    {profiles.length ? (
                      profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.id}
                        </option>
                      ))
                    ) : (
                      <option value="">(no profiles)</option>
                    )}
                  </select>
                  <button
                    className="btn btn-small"
                    onClick={() =>
                      runApply(async () => await applyProfile({ profileId, piIds: selectedIds }))
                    }
                    disabled={controlBusy || !profiles.length || !profileId}
                  >
                    Apply
                  </button>
                </div>
                <div className="muted small">
                  Source: <span className="mono">cable2/config/profiles/*.toml</span>
                </div>
              </div>

              <div className="control-block">
                <div className="control-title">Pin To Channel (Gallery)</div>
                <div className="control-fields">
                  <select className="input" value={channelId} onChange={(e) => setChannelId(e.target.value)} disabled={controlBusy}>
                    {channelOptions.length ? (
                      channelOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))
                    ) : (
                      <option value="">(no channels)</option>
                    )}
                  </select>
                  <button
                    className="btn btn-small"
                    onClick={() =>
                      runApply(async () => await setChannel({ channelId, piIds: selectedIds, lock: channelLock, showQr: channelShowQr, playlist: channelPlaylist }))
                    }
                    disabled={controlBusy || !channelId}
                  >
                    Set
                  </button>
                </div>
                <div className="control-toggles">
                  <label className="toggle">
                    <input type="checkbox" checked={channelLock} onChange={(e) => setChannelLock(e.target.checked)} disabled={controlBusy} />
                    <span>Lock</span>
                  </label>
                  <label className="toggle">
                    <input type="checkbox" checked={channelPlaylist} onChange={(e) => setChannelPlaylist(e.target.checked)} disabled={controlBusy} />
                    <span>Playlist</span>
                  </label>
                  <label className="toggle">
                    <input type="checkbox" checked={channelShowQr} onChange={(e) => setChannelShowQr(e.target.checked)} disabled={controlBusy} />
                    <span>QR</span>
                  </label>
                </div>
              </div>

              <div className="control-block">
                <div className="control-title">Open Program (Art View)</div>
                <div className="control-fields">
                  <select className="input" value={programChannelId} onChange={(e) => setProgramChannelId(e.target.value)} disabled={controlBusy}>
                    {channelOptions.length ? (
                      channelOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))
                    ) : (
                      <option value="">(no channels)</option>
                    )}
                  </select>
                </div>
                <div className="control-fields">
                  <select
                    className="input"
                    value={String(programIndex)}
                    onChange={(e) => setProgramIndex(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                    disabled={controlBusy || !programOptions.length}
                  >
                    {programOptions.length ? (
                      programOptions.map((p) => (
                        <option key={p.i} value={String(p.i)}>
                          {p.label}
                        </option>
                      ))
                    ) : (
                      <option value="0">(no URL programs)</option>
                    )}
                  </select>
                  <button
                    className="btn btn-small"
                    onClick={() =>
                      runApply(async () => await openProgram({ channelId: programChannelId, index: programIndex, piIds: selectedIds }))
                    }
                    disabled={controlBusy || !programChannelId || !programOptions.length}
                  >
                    Open
                  </button>
                </div>
                {programOptions[programIndex]?.url ? (
                  <div className="muted small mono truncate" title={programOptions[programIndex]?.url}>
                    {programOptions[programIndex]?.url}
                  </div>
                ) : null}
              </div>

              <div className="control-block">
                <div className="control-title">Return To Guide</div>
                <div className="control-fields">
                  <button
                    className="btn btn-small"
                    onClick={() =>
                      runApply(async () => await openGuide({ piIds: selectedIds }))
                    }
                    disabled={controlBusy || selectedIds.length === 0}
                  >
                    Guide
                  </button>
                </div>
                <div className="muted small">
                  Sets selected nodes to guide mode (<span className="mono">nosplash=1</span>).
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">
              {loading ? 'Checking...' : `${rows.length} nodes`}
            </div>
            <div className="card-meta">Last tick: {fmtAge(Date.now() - now)} ago</div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="sel-col col-sel">
                    <input
                      type="checkbox"
                      checked={visibleIds.length > 0 && visibleIds.every((id) => selectedById[id])}
                      onChange={(e) => {
                        if (e.target.checked) {
                          const next: Record<string, boolean> = { ...selectedById }
                          for (const id of visibleIds) next[id] = true
                          setSelectedById(next)
                        } else {
                          const next: Record<string, boolean> = { ...selectedById }
                          for (const id of visibleIds) delete next[id]
                          setSelectedById(next)
                        }
                      }}
                      disabled={controlBusy || loading || !visibleIds.length}
                      aria-label="Select visible nodes"
                      title="Select visible rows"
                    />
                  </th>
                  <th>Node</th>
                  <th>Host</th>
                  <th>DNS</th>
                  <th>Ping</th>
                  <th>SSH</th>
                  <th>Node</th>
                  <th>Cable</th>
                  <th>Versions</th>
                  <th>Last</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((pi) => {
                  const health = (pi as any).dnsOk !== undefined ? (pi as FleetPiHealth) : null
                  const kind = rowKind(health ?? (pi as FleetPi))
                  const statusPill =
                    kind === 'muted' ? <Pill kind="muted" label="EXTERNAL" /> :
                    kind === 'bad' ? <Pill kind="bad" label="OFFLINE" /> :
                    kind === 'warn' ? <Pill kind="warn" label="UPDATE" /> :
                    <Pill kind="ok" label="OK" />

                  const expanded = Boolean(expandedById[pi.id])
                  const kioskUrl = health?.chibaNode?.kioskUrl ?? ''
                  const kioskParams: Array<[string, string]> | null = (() => {
                    if (!kioskUrl) return null
                    try {
                      const u = new URL(kioskUrl)
                      return Array.from(u.searchParams.entries()).sort((a, b) => a[0].localeCompare(b[0]))
                    } catch {
                      return null
                    }
                  })()

                  const kioskSummary = (() => {
                    if (!kioskUrl) return null
                    const entries = kioskParams ?? []
                    const get = (k: string) => entries.find(([kk]) => kk === k)?.[1] ?? ''
                    const channel = get('channel')
                    const gallery = get('gallery')
                    const playlist = get('playlist')
                    const nosplash = get('nosplash')
                    const bits = [
                      channel ? `ch=${channel}` : '',
                      gallery ? `g=${gallery}` : '',
                      playlist ? `pl=${playlist}` : '',
                      nosplash ? `ns=${nosplash}` : '',
                    ].filter(Boolean)
                    return bits.length ? `kiosk: ${bits.join(' ')}` : 'kiosk: (set)'
                  })()

                  const catalogChannel = (() => {
                    const chId = kioskParams?.find(([k]) => k === 'channel')?.[1] ?? ''
                    if (!chId) return null
                    const channels: any[] = Array.isArray((catalog as any)?.channels) ? (catalog as any).channels : []
                    return channels.find((c) => c?.id === chId) ?? null
                  })()
                  const channelDeps = (() => {
                    if (!catalogChannel) return null
                    const blocksById = new Map<string, any>()
                    const playlistsById = new Map<string, any>()
                    const mediaById = new Map<string, any>()
                    for (const b of (Array.isArray((catalog as any)?.blocks) ? (catalog as any).blocks : [])) blocksById.set(String(b?.id ?? ''), b)
                    for (const p of (Array.isArray((catalog as any)?.playlists) ? (catalog as any).playlists : [])) playlistsById.set(String(p?.id ?? ''), p)
                    for (const m of (Array.isArray((catalog as any)?.media) ? (catalog as any).media : [])) mediaById.set(String(m?.id ?? ''), m)

                    const blockIds: string[] = Array.isArray(catalogChannel?.blocks) ? catalogChannel.blocks : []
                    const blocks = blockIds.map((id: string) => blocksById.get(String(id)) ?? null).filter(Boolean)
                    const playlistIds = Array.from(new Set(blocks.map((b: any) => String(b?.playlist ?? '')).filter(Boolean)))
                    const playlists = playlistIds.map((id) => playlistsById.get(id) ?? null).filter(Boolean)
                    const mediaIds = Array.from(
                      new Set(
                        playlists
                          .flatMap((pl: any) => Array.isArray(pl?.items) ? pl.items : [])
                          .map((it: any) => String(it?.media ?? ''))
                          .filter(Boolean)
                      )
                    )
                    const media = mediaIds.map((id) => mediaById.get(id) ?? null).filter(Boolean)
                    return { blockIds, playlistIds, mediaIds, blocks, playlists, media }
                  })()

                  return [
                    <tr key={pi.id} className={`row-${kind}`}>
                      <td className="sel-col col-sel">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedById[pi.id])}
                          onChange={(e) => setSelectedById((prev) => ({ ...prev, [pi.id]: e.target.checked }))}
                          disabled={controlBusy || loading}
                          title={`Select ${pi.id}`}
                        />
                      </td>
                      <td className="col-node">
                        <div className="node-cell">
                          <div className="node-name">
                            <button
                              type="button"
                              className="twirl"
                              onClick={() => toggleExpanded(pi.id)}
                              title={expanded ? 'Collapse details' : 'Expand details'}
                            >
                              {expanded ? 'v' : '>'}
                            </button>
                            <span>{pi.nodeName || pi.id}</span>
                          </div>
                          <div className="node-meta">
                            {statusPill}
                            {pi.cable?.orientation ? <span className="muted">{pi.cable.orientation}</span> : null}
                            {pi.cable?.channel ? <span className="muted">ch {pi.cable.channel}</span> : null}
                          </div>
                        </div>
                      </td>
                      <td className="col-host">
                        <div className="mono">{pi.host || '-'}</div>
                        <div className="muted mono">{pi.ip ?? health?.resolvedIp ?? ''}</div>
                      </td>
                      <td className="col-mini">
                        {kind === 'muted'
                          ? <Pill kind="muted" label="-" />
                          : health
                            ? (health.dnsOk ? <Pill kind="ok" label="OK" /> : <Pill kind="bad" label="NO" />)
                            : <Pill kind="muted" label="..." />
                        }
                      </td>
                      <td className="col-mini">{health?.ping?.ok ? <Pill kind="ok" label={`${health.ping.ms ?? 0}ms`} /> : <Pill kind="muted" label={health ? '-' : '...'} />}</td>
                      <td className="col-mini">{health?.tcp?.ssh22?.ok ? <Pill kind="ok" label="22" /> : <Pill kind="muted" label={health ? '-' : '...'} />}</td>
                      <td className="col-mini">{health?.http?.nodeStatus?.ok ? <Pill kind="ok" label="status" /> : <Pill kind="muted" label={health ? '-' : '...'} />}</td>
                      <td className="col-mini">{health?.http?.cableVersion?.ok ? <Pill kind="ok" label="version" /> : <Pill kind="muted" label={health ? '-' : '...'} />}</td>
                      <td className="col-vers">
                        <div className="muted mono">node: {health?.chibaNode?.version ?? '?'}</div>
                        <div className="muted mono">cable: {health?.cableServer?.version ?? '?'}</div>
                        <div className="muted mono">sha: {health?.cableServer?.gitSha ?? '-'}</div>
                        {kioskSummary ? <div className="muted mono truncate" title={kioskUrl}>{kioskSummary}</div> : null}
                      </td>
                      <td className="muted col-last">{health ? `${fmtAge(Date.now() - health.lastCheckedAt)} ago` : '...'}</td>
                      <td className="actions-cell col-act">
                        {(pi.ip || pi.host) ? (
                          <button
                            className="btn btn-small"
                            onClick={() => refreshOne(pi.id)}
                            disabled={checkingById[pi.id] || loading}
                            title="Probe this node only"
                          >
                            {checkingById[pi.id] ? 'Checking…' : 'Check'}
                          </button>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                    </tr>,
                    expanded ? (
                      <tr key={`${pi.id}:detail`} className={`row-detail row-${kind}`}>
                        <td colSpan={11}>
                          <div className="detail-panel">
                            <div className="detail-title">Kiosk URL</div>
                            <div className="detail-grid">
                              <div>
                                <div className="muted small">raw</div>
                                <div className="mono wrap">{kioskUrl || '-'}</div>
                              </div>
                              <div>
                                <div className="muted small">params</div>
                                {kioskParams && kioskParams.length ? (
                                  <table className="kv">
                                    <tbody>
                                      {kioskParams.map(([k, v], idx) => (
                                        <tr key={`${k}:${idx}`}>
                                          <td className="mono k">{k}</td>
                                          <td className="mono v">{v}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                ) : (
                                  <div className="muted small">{kioskUrl ? '(none or unparseable)' : '(no kiosk url)'}</div>
                                )}
                              </div>
                            </div>

                            <div style={{ marginTop: 14 }}>
                              <div className="detail-title">Resolved Content (New Model)</div>
                              {channelDeps ? (
                                <div className="detail-grid">
                                  <div>
                                    <div className="muted small">channel</div>
                                    <div className="mono">{String(catalogChannel?.id ?? '-')}</div>
                                    <div className="muted small">blocks</div>
                                    <div className="mono wrap">{channelDeps.blockIds.length ? channelDeps.blockIds.join(', ') : '(none)'}</div>
                                    <div className="muted small">playlists</div>
                                    <div className="mono wrap">{channelDeps.playlistIds.length ? channelDeps.playlistIds.join(', ') : '(none)'}</div>
                                  </div>
                                  <div>
                                    <div className="muted small">media deps</div>
                                    <div className="mono">{channelDeps.mediaIds.length} items</div>
                                    <div className="muted small">first few</div>
                                    <div className="mono wrap">{channelDeps.mediaIds.slice(0, 6).join(', ') || '(none)'}</div>
                                  </div>
                                </div>
                              ) : (
                                <div className="muted small">
                                  {catalog ? 'No channel catalog match (or channel not set).' : 'Catalog not loaded yet.'}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null,
                  ]
                })}
                {!rows.length ? (
                  <tr>
                    <td colSpan={11} className="empty">
                      {loading ? 'Loading...' : 'No nodes (check registry config on the server).'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
        </>
        )}
      </main>
    </div>
  )
}
