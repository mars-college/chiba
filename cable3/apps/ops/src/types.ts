export type PingResult = {
  ok: boolean
  ms: number | null
  error?: string
}

export type TcpCheck = {
  ok: boolean
  ms: number | null
  error?: string
}

export type HttpCheck = {
  ok: boolean
  ms: number | null
  status: number | null
  error?: string
}

export type RemoteCableVersion = {
  version: string
  gitSha: string | null
}

export type RemoteNodeStatus = {
  version: string | null
  ipReported: string | null
  kioskUrl?: string | null
}

export type FleetPi = {
  registryId?: string
  id: string
  host: string
  ip?: string
  nodeName: string
  cable?: {
    orientation?: string
    channel?: string
  }
}

export type FleetPiHealth = FleetPi & {
  resolvedIp: string | null
  dnsOk: boolean
  ping: PingResult
  tcp: {
    ssh22: TcpCheck
    node8080: TcpCheck
    cable8787: TcpCheck
  }
  http: {
    nodeStatus: HttpCheck
    cableVersion: HttpCheck
  }
  chibaNode: RemoteNodeStatus
  cableServer: RemoteCableVersion | null
  needsUpdate: boolean | null
  lastCheckedAt: number
  connectivity?: {
    score: number
    total: number
    status: 'online' | 'degraded' | 'offline'
    lastCheckedAt: number
  }
  errorSummary?: string
}

export type FleetResponse = {
  now: number
  local: {
    gitSha: string | null
    registryPath: string | null
  }
  pis: FleetPiHealth[]
}

export type OpsNodeConnectivity = {
  registryId: string
  nodeId: string
  namespace: string
  dnsOk: boolean
  pingOk: boolean
  sshOk: boolean
  nodeApiOk: boolean
  cableApiOk: boolean
  connectivityScore: number
  connectivityTotal: number
  status: 'online' | 'degraded' | 'offline'
  latencyMs: number | null
  errorSummary?: string
  checkedAt: number
}

export type OpsNodeRecord = {
  registryId: string
  nodeId: string
  host?: string
  ip?: string
  nodeName?: string
  orientation?: string
  displayRotate?: 0 | 90 | 180 | 270
  guidePort?: number
  nodePort?: number
  serverPort?: number
  apiKey?: string
  importedAt?: number
  createdAt?: number
  updatedAt?: number
  connectivity?: OpsNodeConnectivity | null
}

export type OpsNodesResponse = {
  ok: boolean
  registryId: string
  namespace: string
  count: number
  nodes: OpsNodeRecord[]
}

export type OpsProfile = {
  id: string
  file: string
  modePath: string
  defaults: {
    mode?: string
    target_kind?: 'media' | 'playlist' | 'block' | 'channel'
    target_id?: string
    theme?: string
    nosplash?: boolean
    hud?: 'always' | 'start' | 'never'
    hud_sec?: number
    lock?: boolean
    qr?: boolean
    channel?: string
    playlist?: boolean
    prefetch_channels?: string[]
    prefetch_stash?: boolean
    prefetch_cache?: boolean
    display_rotate?: 0 | 90 | 180 | 270
    scale?: number
    text_scale?: number
    hours?: number
    prefetch_targets?: string[]
  }
  overridePis: string[]
}

export type OpsProfilesResponse = {
  ok: boolean
  profiles: OpsProfile[]
}

export type OpsApplyResult = {
  id: string
  host: string
  ip: string | null
  nodeName: string
  guidePort: number
  url: string
  ok: boolean
  status: number | null
  ms: number | null
  error: string | null
  state?: { ok: boolean; status: number | null; ms: number | null; error?: string } | null
  prefetch?: {
    channelIds: string[]
    stash?: { ok: boolean; status: number | null; ms: number | null; queued: number | null; error?: string }
    cache?: { ok: boolean; status: number | null; ms: number | null; queued: number | null; error?: string }
  } | null
}

export type OpsApplyResponse = {
  ok: boolean
  results: OpsApplyResult[]
  modePath?: string
  channelId?: string
  index?: number
  target?: 'profile' | 'channel' | 'block' | 'playlist' | 'media'
  id?: string
  resolvedChannelId?: string | null
  warning?: string
}

export type OpsApplyTarget = 'profile' | 'channel' | 'block' | 'playlist' | 'media'

export type OpsApplyTargetRequest = {
  target: OpsApplyTarget
  id: string
  piIds: string[]
  dryRun?: boolean
  mode?: 'guide' | 'gallery'
  targetKind?: 'media' | 'playlist' | 'block' | 'channel'
  targetId?: string
  channel?: string
  lock?: boolean
  showQr?: boolean
  playlist?: boolean
  nosplash?: boolean
  hudMode?: 'always' | 'start' | 'never'
  hudShowSec?: number
  theme?: string
  displayRotate?: 0 | 90 | 180 | 270
  scale?: number
  textScale?: number
  hours?: number
}

export type OpsCatalogResponse = {
  ok: boolean
  configPath?: string
  manifestDir?: string
  libraryRoots?: string[]
  counts?: { channels: number; blocks: number; playlists: number; media: number }
  channels?: any[]
  blocks?: any[]
  playlists?: any[]
  media?: any[]
  error?: string
}

export type GuideIndex = {
  generatedAt?: number
  slotMinutes?: number
  slotCount?: number
  startTime?: string
  channels: Array<{
    id: string
    number?: string
    name?: string
    callSign?: string
    description?: string
    schedule: Array<{
      title?: string
      subtitle?: string
      url?: string | null
      artist?: string
      description?: string
      start?: number
      end?: number
      span?: number
    }>
  }>
}
