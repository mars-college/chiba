#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { applyKioskStateToFleetFromObject, applyModeToFleet, loadModeFromFile } from './ops-apply-mode.js';

function loadEnvFileIfPresent(p: string) {
  try {
    if (!fs.existsSync(p)) return;
    const raw = fs.readFileSync(p, 'utf-8');
    for (const line of raw.split('\n')) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const m = s.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m) continue;
      const key = m[1];
      let val = (m[2] ?? '').trim();
      // Strip surrounding quotes if present.
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      // Don't clobber explicitly provided env vars.
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // ignore; env file is best-effort
  }
}

function usage(exitCode = 1) {
  // Keep this dependency-free: parse args manually.
  console.log(`
Usage:
  node dist/ops-cli.js apply-mode [options]
  node dist/ops-cli.js apply-state [options]
  pnpm -C cable/apps/server ops:apply-mode -- [options]

Options:
  --inventory PATH   Inventory registry TOML (default: scripts/pis/registry.toml)
  --mode PATH        Mode TOML (required)
  --pi ID            Apply to a single pi (repeatable)
  --all              Apply to all pis (default if no --pi provided)
  --concurrency N    Parallelism (default: 8)
  --timeout-ms N     Per-node HTTP timeout (default: 2500)
  --dry-run          Print what would happen (no HTTP)

Secrets:
  Set per-node API keys in env, e.g.:
    CHIBA_API_KEY_UPPER_EAST_2=... (pi id: upper-east-2)

Notes:
  - apply-mode uses the node API (8080) and can require API keys.
  - apply-state uses the cable server API (8787) and does not restart Chromium.
`);
  process.exit(exitCode);
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const findRepoRoot = (): string => {
    // Prefer CWD so `pnpm -C ...` works, but also support running from dist directly.
    let cur = process.cwd();
    for (let i = 0; i < 8; i += 1) {
      const scriptsPis = path.join(cur, 'scripts', 'pis');
      if (fs.existsSync(scriptsPis)) return cur;
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
    // Fallback: dist lives at <repo>/cable/apps/server/dist.
    return path.resolve(__dirname, '../../../..');
  };

  const repoRoot = findRepoRoot();

  // Best-effort load local secrets so you don't have to `source` manually.
  // Scripts already use these paths; keep behavior aligned.
  loadEnvFileIfPresent(path.join(repoRoot, '.env.pis.local'));
  loadEnvFileIfPresent(path.join(repoRoot, 'scripts', 'pis', '.env.pis.local'));

  const argv = process.argv.slice(2);
  if (argv.length === 0) usage(1);

  const cmd = argv.shift();
  if (cmd !== 'apply-mode' && cmd !== 'apply-state') {
    console.error(`Unknown command: ${cmd ?? ''}`);
    usage(1);
  }

  let inventoryPath = 'scripts/pis/registry.toml';
  let modePath = '';
  const piIds: string[] = [];
  let concurrency = 8;
  let timeoutMs = 2500;
  let dryRun = false;

  while (argv.length > 0) {
    const a = argv.shift() as string;
    // pnpm sometimes forwards a literal "--" into argv when using `pnpm <script> -- ...`.
    // Treat it as a no-op separator.
    if (a === '--') continue;
    if (a.startsWith('--inventory=')) {
      inventoryPath = a.slice('--inventory='.length);
      continue;
    }
    if (a.startsWith('--mode=')) {
      modePath = a.slice('--mode='.length);
      continue;
    }
    if (a.startsWith('--pi=')) {
      piIds.push(a.slice('--pi='.length));
      continue;
    }
    if (a.startsWith('--concurrency=')) {
      concurrency = Number(a.slice('--concurrency='.length));
      continue;
    }
    if (a.startsWith('--timeout-ms=')) {
      timeoutMs = Number(a.slice('--timeout-ms='.length));
      continue;
    }

    switch (a) {
      case '--inventory':
        inventoryPath = String(argv.shift() ?? '');
        break;
      case '--mode':
        modePath = String(argv.shift() ?? '');
        break;
      case '--pi':
        piIds.push(String(argv.shift() ?? ''));
        break;
      case '--all':
        // default behavior; no-op
        break;
      case '--concurrency':
        concurrency = Number(argv.shift() ?? '8');
        break;
      case '--timeout-ms':
        timeoutMs = Number(argv.shift() ?? '2500');
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--help':
      case '-h':
        usage(0);
        break;
      default:
        console.error(`Unknown arg: ${a}`);
        usage(1);
    }
  }

  if (!modePath) {
    console.error('Missing required: --mode PATH');
    usage(1);
  }

  const results = await (async () => {
    if (cmd === 'apply-mode') {
      return await applyModeToFleet({
        repoRoot,
        inventoryPath,
        modePath,
        piIds: piIds.length > 0 ? piIds : undefined,
        concurrency: Number.isFinite(concurrency) ? concurrency : 8,
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 2500,
        dryRun,
      });
    }
    const mode = await loadModeFromFile(repoRoot, modePath);
    return await applyKioskStateToFleetFromObject({
      repoRoot,
      inventoryPath,
      mode,
      piIds: piIds.length > 0 ? piIds : undefined,
      concurrency: Number.isFinite(concurrency) ? concurrency : 8,
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 2500,
      dryRun,
    });
  })();

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    const prefix = r.ok ? 'ok ' : 'err';
    const detail =
      r.ok
        ? dryRun
          ? 'dry-run'
          : `http ${r.status ?? ''} ${r.ms ?? ''}ms`
        : `${r.error ?? 'error'}`;
    console.log(`[${prefix}] ${r.pi.id} (${r.pi.host || 'no-host'}) -> ${detail}`);
    console.log(`      ${r.url}`);
  }

  if (failed.length > 0) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error((err as Error)?.stack ?? String(err));
  process.exit(1);
});
