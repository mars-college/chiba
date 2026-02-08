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
}

export type FleetPi = {
  id: string
  host: string
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

