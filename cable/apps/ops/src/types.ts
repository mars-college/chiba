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

export type OpsProfile = {
  id: string
  file: string
  modePath: string
  defaults: {
    mode?: string
    theme?: string
    nosplash?: boolean
    lock?: boolean
    qr?: boolean
    channel?: string
    playlist?: boolean
    scale?: number
    text_scale?: number
    hours?: number
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
}

export type OpsApplyResponse = {
  ok: boolean
  results: OpsApplyResult[]
  modePath?: string
  channelId?: string
  index?: number
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
