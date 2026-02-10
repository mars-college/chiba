import { useEffect, useMemo, useRef, useState } from 'react'
import { applyProfile, fetchFleet, fetchGuideIndex, fetchPiHealth, fetchProfiles, openFleetStream, openProgram, setChannel, type FleetStreamMeta } from './lib/api'
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
  const abortRef = useRef<AbortController | null>(null)
  const streamRef = useRef<{ close: () => void } | null>(null)

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

  useEffect(() => {
    startStream({ reset: true })
    return () => {
      closeStream()
      abortRef.current?.abort()
    }
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
          <button className={`nav-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
            Fleet
          </button>
          <button className={`nav-btn ${filter === 'bad' ? 'active' : ''}`} onClick={() => setFilter('bad')}>
            Offline
          </button>
          <button className={`nav-btn ${filter === 'warn' ? 'active' : ''}`} onClick={() => setFilter('warn')}>
            Needs Update
          </button>
          <button className={`nav-btn ${filter === 'ok' ? 'active' : ''}`} onClick={() => setFilter('ok')}>
            Healthy
          </button>
        </nav>

        <div className="sidebar-footer">
          <div>registry: {meta?.local.registryPath ?? 'not set'}</div>
          <div>local git: {meta?.local.gitSha ?? 'unknown'}</div>
        </div>
      </aside>

      <main className="main-content">
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
                  Source: <span className="mono">cable/config/profiles/*.toml</span>
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
                  <th className="sel-col">
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

                  return (
                    <tr key={pi.id} className={`row-${kind}`}>
                      <td className="sel-col">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedById[pi.id])}
                          onChange={(e) => setSelectedById((prev) => ({ ...prev, [pi.id]: e.target.checked }))}
                          disabled={controlBusy || loading}
                          title={`Select ${pi.id}`}
                        />
                      </td>
                      <td>
                        <div className="node-cell">
                          <div className="node-name">{pi.nodeName || pi.id}</div>
                          <div className="node-meta">
                            {statusPill}
                            {pi.cable?.orientation ? <span className="muted">{pi.cable.orientation}</span> : null}
                            {pi.cable?.channel ? <span className="muted">ch {pi.cable.channel}</span> : null}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="mono">{pi.host || '-'}</div>
                        <div className="muted mono">{pi.ip ?? health?.resolvedIp ?? ''}</div>
                      </td>
                      <td>
                        {kind === 'muted'
                          ? <Pill kind="muted" label="-" />
                          : health
                            ? (health.dnsOk ? <Pill kind="ok" label="OK" /> : <Pill kind="bad" label="NO" />)
                            : <Pill kind="muted" label="..." />
                        }
                      </td>
                      <td>{health?.ping?.ok ? <Pill kind="ok" label={`${health.ping.ms ?? 0}ms`} /> : <Pill kind="muted" label={health ? '-' : '...'} />}</td>
                      <td>{health?.tcp?.ssh22?.ok ? <Pill kind="ok" label="22" /> : <Pill kind="muted" label={health ? '-' : '...'} />}</td>
                      <td>{health?.http?.nodeStatus?.ok ? <Pill kind="ok" label="status" /> : <Pill kind="muted" label={health ? '-' : '...'} />}</td>
                      <td>{health?.http?.cableVersion?.ok ? <Pill kind="ok" label="version" /> : <Pill kind="muted" label={health ? '-' : '...'} />}</td>
                      <td>
                        <div className="muted mono">node: {health?.chibaNode?.version ?? '?'}</div>
                        <div className="muted mono">cable: {health?.cableServer?.version ?? '?'}</div>
                        <div className="muted mono">sha: {health?.cableServer?.gitSha ?? '-'}</div>
                        {health?.chibaNode?.kioskUrl ? (
                          <div className="muted mono truncate" title={health.chibaNode.kioskUrl}>
                            kiosk: {health.chibaNode.kioskUrl}
                          </div>
                        ) : null}
                      </td>
                      <td className="muted">{health ? `${fmtAge(Date.now() - health.lastCheckedAt)} ago` : '...'}</td>
                      <td className="actions-cell">
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
                    </tr>
                  )
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
      </main>
    </div>
  )
}
