import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchFleet, fetchPiHealth, openFleetStream, type FleetStreamMeta } from './lib/api'
import type { FleetPi, FleetPiHealth } from './types'

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
  if (!('host' in pi) || !pi.host) return 'muted'
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
              <div className="page-subtitle">Active probes: DNS, ping (best effort), TCP(22/8080/8787), HTTP(/status, /api/version)</div>
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
                        <div className="muted mono">{health?.resolvedIp ?? ''}</div>
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
                        <div className="muted mono">cable: {health?.cableServer?.gitSha ?? '?'}</div>
                      </td>
                      <td className="muted">{health ? `${fmtAge(Date.now() - health.lastCheckedAt)} ago` : '...'}</td>
                      <td className="actions-cell">
                        {pi.host ? (
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
                    <td colSpan={10} className="empty">
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
