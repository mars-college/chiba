import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import dns from 'node:dns/promises';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import toml from '@iarna/toml';

const execFileAsync = promisify(execFile);

export type FleetPi = {
  id: string;
  host: string;
  ip?: string;
  nodeName: string;
  cable?: { orientation?: string; channel?: string };
};

export type FleetPiHealth = FleetPi & {
  resolvedIp: string | null;
  dnsOk: boolean;
  ping: { ok: boolean; ms: number | null; error?: string };
  tcp: {
    ssh22: { ok: boolean; ms: number | null; error?: string };
    node8080: { ok: boolean; ms: number | null; error?: string };
    cable8787: { ok: boolean; ms: number | null; error?: string };
  };
  http: {
    nodeStatus: { ok: boolean; ms: number | null; status: number | null; error?: string };
    cableVersion: { ok: boolean; ms: number | null; status: number | null; error?: string };
  };
  chibaNode: { version: string | null; ipReported: string | null };
  cableServer: { version: string; gitSha: string | null } | null;
  needsUpdate: boolean | null;
  lastCheckedAt: number;
  errorSummary?: string;
};

export type FleetResponse = {
  now: number;
  local: { gitSha: string | null; registryPath: string | null };
  pis: FleetPiHealth[];
};

function formatHostForUrl(hostOrIp: string): string {
  // For IPv6 literal URLs need brackets: http://[::1]:8787
  if (hostOrIp.includes(':') && !hostOrIp.startsWith('[')) return `[${hostOrIp}]`;
  return hostOrIp;
}

type RegistryDefaults = {
  cablePort: number;
};

async function readRegistryDefaults(registryPath: string | null): Promise<RegistryDefaults> {
  let cablePort = 8787;
  try {
    if (registryPath) {
      const raw = await fsp.readFile(registryPath, 'utf-8');
      const parsed = toml.parse(raw) as any;
      const p = parsed?.defaults?.server_port;
      if (typeof p === 'number' && Number.isFinite(p)) cablePort = p;
      if (typeof p === 'string' && p.trim() && Number.isFinite(Number(p))) cablePort = Number(p);
    }
  } catch {
    // ignore; keep defaults
  }
  return { cablePort };
}

function normalizeHost(input: string): string {
  const raw = input.trim();
  if (!raw) return '';
  try {
    // allow accidental scheme/prefix
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`);
    return u.hostname;
  } catch {
    return raw.replace(/^https?:\/\//i, '').split('/')[0] ?? raw;
  }
}

function getDefaultRegistryPath(repoRoot: string): string | null {
  const candidates = [
    path.resolve(repoRoot, 'scripts/pis/registry.toml'),
    path.resolve(repoRoot, 'scripts/pis/registry.local.toml'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

export async function loadFleetFromRegistry(
  repoRoot: string,
  registryPath: string | null
): Promise<{ registryPath: string | null; pis: FleetPi[] }> {
  const resolved = registryPath
    ? path.resolve(repoRoot, registryPath)
    : getDefaultRegistryPath(repoRoot);
  if (!resolved) return { registryPath: null, pis: [] };
  const raw = await fsp.readFile(resolved, 'utf-8');
  const parsed = toml.parse(raw) as any;
  const pisObj = parsed?.pis ?? {};
  const pis: FleetPi[] = [];
  for (const [id, node] of Object.entries<any>(pisObj)) {
    const host = normalizeHost(String(node?.host ?? ''));
    const ip = normalizeHost(String(node?.ip ?? ''));
    const nodeName = String(node?.node_name ?? node?.nodeName ?? id);
    const orientation =
      typeof node?.orientation === 'string'
        ? node.orientation
        : typeof node?.cable?.orientation === 'string'
          ? node.cable.orientation
          : undefined;
    const cable = node?.cable
      ? {
          orientation,
          channel:
            typeof node.cable.channel === 'string'
              ? node.cable.channel
              : typeof node.cable.channel === 'number'
                ? String(node.cable.channel)
                : undefined,
        }
      : orientation
        ? { orientation }
        : undefined;
    pis.push({ id, host, ip: ip || undefined, nodeName, cable });
  }
  pis.sort((a, b) => a.id.localeCompare(b.id));
  return { registryPath: resolved, pis };
}

type LimitFn = <T>(fn: () => Promise<T>) => Promise<T>;

function createLimit(concurrency: number): LimitFn {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= concurrency) return;
    const job = queue.shift();
    if (!job) return;
    active += 1;
    job();
  };
  return async <T>(fn: () => Promise<T>) =>
    await new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then((val) => resolve(val))
          .catch((err) => reject(err))
          .finally(() => {
            active -= 1;
            next();
          });
      });
      next();
    });
}

async function tcpCheck(host: string, port: number, timeoutMs: number) {
  const started = Date.now();
  return await new Promise<{ ok: boolean; ms: number | null; error?: string }>((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean, error?: string) => {
      try { socket.destroy(); } catch {}
      const ms = Date.now() - started;
      resolve({ ok, ms: ok ? ms : null, error });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false, 'timeout'));
    socket.once('error', (err) => done(false, err.message));
    socket.connect(port, host);
  });
}

async function httpCheckJson(url: string, timeoutMs: number): Promise<{ ok: boolean; ms: number | null; status: number | null; json?: any; error?: string }> {
  const started = Date.now();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    const status = res.status;
    const txt = await res.text().catch(() => '');
    let json: any = null;
    try {
      json = txt ? JSON.parse(txt) : null;
    } catch {
      json = null;
    }
    const ok = res.ok;
    return { ok, ms: Date.now() - started, status, json };
  } catch (err) {
    return { ok: false, ms: null, status: null, error: (err as Error).message };
  } finally {
    clearTimeout(t);
  }
}

async function pingOnce(
  host: string,
  timeoutMs: number
): Promise<{ ok: boolean; ms: number | null; resolvedIp: string | null; dnsOk: boolean; error?: string }> {
  // Best-effort ping:
  // - doubles as a "resolve" step for mDNS (.local) without blocking Node's DNS threadpool.
  // - we still enforce a hard subprocess timeout.
  const platform = process.platform;
  const args: string[] = ['-n', '-c', '1'];
  if (platform === 'darwin') {
    // macOS: -W is per-packet timeout in milliseconds.
    args.push('-W', String(Math.max(1, Math.floor(timeoutMs))), host);
  } else {
    // Linux: -W is per-packet timeout in seconds.
    args.push('-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), host);
  }

  const started = Date.now();
  try {
    const { stdout } = await execFileAsync('ping', args, { timeout: timeoutMs + 300 });
    const out = String(stdout ?? '');
    const ipMatch = out.match(/^PING\s+\S+\s+\(([^)]+)\)/m);
    const resolvedIp = ipMatch?.[1] ?? null;
    const dnsOk = Boolean(resolvedIp);
    const m = out.match(/time[=<]([0-9.]+)\s*ms/i);
    const ms = m ? Number(m[1]) : Date.now() - started;
    return { ok: true, ms: Number.isFinite(ms) ? Math.round(ms) : null, resolvedIp, dnsOk };
  } catch (err) {
    const anyErr = err as any;
    const out = String(anyErr?.stdout ?? '');
    const ipMatch = out.match(/^PING\s+\S+\s+\(([^)]+)\)/m);
    const resolvedIp = ipMatch?.[1] ?? null;
    const dnsOk = Boolean(resolvedIp);
    return {
      ok: false,
      ms: null,
      resolvedIp,
      dnsOk,
      error: (err as Error).message,
    };
  }
}

function readGitSha(repoRoot: string): string | null {
  try {
    const headPath = path.join(repoRoot, '.git/HEAD');
    if (!fs.existsSync(headPath)) return null;
    const head = fs.readFileSync(headPath, 'utf-8').trim();
    if (head.startsWith('ref:')) {
      const ref = head.replace('ref:', '').trim();
      const refPath = path.join(repoRoot, '.git', ref);
      if (fs.existsSync(refPath)) {
        return fs.readFileSync(refPath, 'utf-8').trim().slice(0, 12);
      }
      const packed = path.join(repoRoot, '.git/packed-refs');
      if (fs.existsSync(packed)) {
        const lines = fs.readFileSync(packed, 'utf-8').split('\n');
        for (const line of lines) {
          if (!line || line.startsWith('#') || line.startsWith('^')) continue;
          const [sha, name] = line.split(' ');
          if (name === ref && sha) return sha.trim().slice(0, 12);
        }
      }
      return null;
    }
    return head.slice(0, 12);
  } catch {
    return null;
  }
}

function readPackageVersion(pkgPath: string): string {
  try {
    const raw = fs.readFileSync(pkgPath, 'utf-8');
    const parsed = JSON.parse(raw) as any;
    return typeof parsed?.version === 'string' ? parsed.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function getLocalOpsMeta(repoRoot: string): { gitSha: string | null } {
  return { gitSha: readGitSha(repoRoot) };
}

async function probeOnePi(opts: {
  repoRoot: string;
  registryDefaults: RegistryDefaults;
  localGitSha: string | null;
  timeoutMs: number;
  pi: FleetPi;
}): Promise<FleetPiHealth> {
  const { registryDefaults, localGitSha, timeoutMs } = opts;
  const lastCheckedAt = Date.now();
  const host = normalizeHost(opts.pi.host);
  const ip = normalizeHost(String(opts.pi.ip ?? ''));
  const addr = ip || host;

  if (!addr) {
    return {
      ...opts.pi,
      host,
      ip: ip || undefined,
      resolvedIp: null,
      dnsOk: false,
      ping: { ok: false, ms: null, error: 'missing_host_or_ip' },
      tcp: {
        ssh22: { ok: false, ms: null, error: 'missing_host_or_ip' },
        node8080: { ok: false, ms: null, error: 'missing_host_or_ip' },
        cable8787: { ok: false, ms: null, error: 'missing_host_or_ip' },
      },
      http: {
        nodeStatus: { ok: false, ms: null, status: null, error: 'missing_host_or_ip' },
        cableVersion: { ok: false, ms: null, status: null, error: 'missing_host_or_ip' },
      },
      chibaNode: { version: null, ipReported: null },
      cableServer: null,
      needsUpdate: null,
      lastCheckedAt,
      errorSummary: 'missing_host_or_ip',
    } satisfies FleetPiHealth;
  }

  // Prefer static IP from registry (avoids flaky mDNS + broken client-to-client networks).
  // If no IP is configured, fall back to host (often .local).
  const pingProbe = await pingOnce(addr, timeoutMs);
  const resolvedIp = ip || pingProbe.resolvedIp;
  const dnsOk = Boolean(ip) || pingProbe.dnsOk;
  const ping = { ok: pingProbe.ok, ms: pingProbe.ms, error: pingProbe.ok ? undefined : pingProbe.error };

  const target = ip || resolvedIp || host;
  const [ssh22, node8080, cable8787] = await Promise.all([
    tcpCheck(target, 22, timeoutMs),
    tcpCheck(target, 8080, timeoutMs),
    tcpCheck(target, registryDefaults.cablePort, timeoutMs),
  ]);

  const nodeStatusHttp = node8080.ok
    ? await httpCheckJson(`http://${formatHostForUrl(target)}:8080/status`, timeoutMs + 700)
    : { ok: false, ms: null, status: null, error: 'tcp_8080_failed' };

  const cableVersionHttp = cable8787.ok
    ? await httpCheckJson(
        `http://${formatHostForUrl(target)}:${registryDefaults.cablePort}/api/version`,
        timeoutMs + 700
      )
    : { ok: false, ms: null, status: null, error: 'tcp_8787_failed' };

  const chibaNode = {
    version: null as string | null,
    ipReported: null as string | null,
  };
  if (nodeStatusHttp.ok && nodeStatusHttp.json?.data?.node) {
    const n = nodeStatusHttp.json.data.node;
    if (typeof n.version === 'string') chibaNode.version = n.version;
    if (typeof n.ip === 'string') chibaNode.ipReported = n.ip;
  }

  let needsUpdate: boolean | null = null;
  if (cableVersionHttp.ok && cableVersionHttp.json) {
    const remoteGit =
      typeof cableVersionHttp.json?.gitSha === 'string'
        ? cableVersionHttp.json.gitSha
        : typeof cableVersionHttp.json?.git?.sha === 'string'
          ? cableVersionHttp.json.git.sha
          : null;
    if (localGitSha && remoteGit) needsUpdate = localGitSha !== remoteGit;
  }

  const errorSummary =
    !dnsOk ? 'dns' :
    !ssh22.ok && !node8080.ok && !cable8787.ok && !ping.ok ? 'unreachable' :
    '';

  return {
    ...opts.pi,
    host,
    resolvedIp,
    dnsOk,
    ping,
    tcp: { ssh22, node8080, cable8787 },
    http: {
      nodeStatus: {
        ok: nodeStatusHttp.ok,
        ms: nodeStatusHttp.ok ? Math.round(nodeStatusHttp.ms ?? 0) : null,
        status: nodeStatusHttp.status,
        error: nodeStatusHttp.ok ? undefined : nodeStatusHttp.error,
      },
      cableVersion: {
        ok: cableVersionHttp.ok,
        ms: cableVersionHttp.ok ? Math.round(cableVersionHttp.ms ?? 0) : null,
        status: cableVersionHttp.status,
        error: cableVersionHttp.ok ? undefined : cableVersionHttp.error,
      },
    },
    chibaNode,
    cableServer: (cableVersionHttp.ok && cableVersionHttp.json)
      ? {
          version: typeof cableVersionHttp.json?.version === 'string'
            ? cableVersionHttp.json.version
            : '0.0.0',
          gitSha:
            typeof cableVersionHttp.json?.gitSha === 'string'
              ? cableVersionHttp.json.gitSha
              : typeof cableVersionHttp.json?.git?.sha === 'string'
                ? cableVersionHttp.json.git.sha
                : null,
        }
      : null,
    needsUpdate,
    lastCheckedAt,
    errorSummary: errorSummary || undefined,
  } satisfies FleetPiHealth;
}

export async function probePiHealth(opts: {
  repoRoot: string;
  registryPath: string | null;
  timeoutMs?: number;
  pi: FleetPi;
}): Promise<FleetPiHealth> {
  const timeoutMs = opts.timeoutMs ?? 1200;
  const localGitSha = readGitSha(opts.repoRoot);
  const registryDefaults = await readRegistryDefaults(opts.registryPath);
  return await probeOnePi({
    repoRoot: opts.repoRoot,
    registryDefaults,
    localGitSha,
    timeoutMs,
    pi: opts.pi,
  });
}

function createAsyncQueue<T>() {
  const items: T[] = [];
  let done = false;
  let notify: (() => void) | null = null;
  const push = (item: T) => {
    if (done) return;
    items.push(item);
    notify?.();
    notify = null;
  };
  const end = () => {
    done = true;
    notify?.();
    notify = null;
  };
  const iter = async function* () {
    while (true) {
      if (items.length) {
        yield items.shift() as T;
        continue;
      }
      if (done) return;
      await new Promise<void>((resolve) => (notify = resolve));
    }
  };
  return { push, end, iter: iter() };
}

export async function probeFleetHealth(opts: {
  repoRoot: string;
  registryPath: string | null;
  pis: FleetPi[];
  concurrency?: number;
  timeoutMs?: number;
}): Promise<AsyncIterable<FleetPiHealth>> {
  const timeoutMs = opts.timeoutMs ?? 1200;
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const limit = createLimit(concurrency);
  const localGitSha = readGitSha(opts.repoRoot);
  const registryDefaults = await readRegistryDefaults(opts.registryPath);

  const q = createAsyncQueue<FleetPiHealth>();
  const tasks = opts.pis.map((pi) =>
    limit(async () => {
      const health = await probeOnePi({
        repoRoot: opts.repoRoot,
        registryDefaults,
        localGitSha,
        timeoutMs,
        pi,
      });
      q.push(health);
    })
  );

  void Promise.allSettled(tasks).then(() => q.end());
  return q.iter;
}

export async function buildFleetResponse(opts: {
  repoRoot: string;
  registryPath: string | null;
  concurrency?: number;
  timeoutMs?: number;
}): Promise<FleetResponse> {
  const now = Date.now();
  const timeoutMs = opts.timeoutMs ?? 1200;
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const limit = createLimit(concurrency);
  const localGitSha = readGitSha(opts.repoRoot);
  const { registryPath, pis } = await loadFleetFromRegistry(opts.repoRoot, opts.registryPath);

  const registryDefaults = await readRegistryDefaults(registryPath);

  const results = await Promise.all(
    pis.map((pi) =>
      limit(async () => {
        return await probeOnePi({
          repoRoot: opts.repoRoot,
          registryDefaults,
          localGitSha,
          timeoutMs,
          pi,
        });
      })
    )
  );

  return {
    now,
    local: { gitSha: localGitSha, registryPath },
    pis: results,
  };
}
