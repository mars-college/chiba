#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { applyModeToFleet } from './ops-apply-mode.js';

function usage(exitCode = 1) {
  // Keep this dependency-free: parse args manually.
  console.log(`
Usage:
  node dist/ops-cli.js apply-mode [options]
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

  const argv = process.argv.slice(2);
  if (argv.length === 0) usage(1);

  const cmd = argv.shift();
  if (cmd !== 'apply-mode') {
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

  const results = await applyModeToFleet({
    repoRoot,
    inventoryPath,
    modePath,
    piIds: piIds.length > 0 ? piIds : undefined,
    concurrency: Number.isFinite(concurrency) ? concurrency : 8,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 2500,
    dryRun,
  });

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
