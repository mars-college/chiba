#!/usr/bin/env node
/**
 * Local "kiosk" simulator for debugging the node /kiosk-url contract.
 *
 * - Watches a Chiba directory for `.kiosk-url` updates (written by node API).
 * - Watches `/tmp/chiba-kiosk-restart` (touched by node API) to trigger reload.
 * - Opens a Playwright Chromium window and navigates to the effective URL.
 *
 * Usage:
 *   node scripts/dev/kiosk-sim.mjs --chiba-dir ./.tmp/chiba
 *   node scripts/dev/kiosk-sim.mjs --chiba-dir /home/pi/chiba --headless
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

function parseArgs(argv) {
  const out = { chibaDir: '', headless: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--chiba-dir') {
      out.chibaDir = String(argv[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (a.startsWith('--chiba-dir=')) {
      out.chibaDir = a.slice('--chiba-dir='.length);
      continue;
    }
    if (a === '--headless') {
      out.headless = true;
      continue;
    }
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readTextFile(p) {
  try {
    return fs.readFileSync(p, 'utf-8').trim();
  } catch {
    return '';
  }
}

function readEffectiveUrl(chibaDir) {
  // Mirror scripts/run-kiosk.sh behavior (env > file > default).
  const envUrl = (process.env.CHIBA_KIOSK_URL || process.env.KIOSK_URL || '').trim();
  if (envUrl) return envUrl;
  const fileUrl = readTextFile(path.join(chibaDir, '.kiosk-url'));
  if (fileUrl) return fileUrl;
  return 'http://localhost:8080/player';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chibaDir = path.resolve(process.cwd(), args.chibaDir || './.tmp/chiba');
  fs.mkdirSync(chibaDir, { recursive: true });

  const kioskUrlFile = path.join(chibaDir, '.kiosk-url');
  const restartSignal = '/tmp/chiba-kiosk-restart';

  console.log(`[kiosk-sim] CHIBA_DIR=${chibaDir}`);
  console.log(`[kiosk-sim] kioskUrlFile=${kioskUrlFile}`);
  console.log(`[kiosk-sim] restartSignal=${restartSignal}`);

  let currentUrl = readEffectiveUrl(chibaDir);
  console.log(`[kiosk-sim] initial url: ${currentUrl}`);

  const browser = await chromium.launch({
    headless: args.headless,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const goto = async (url, reason) => {
    const next = String(url || '').trim();
    if (!next) return;
    if (next === currentUrl) return;
    currentUrl = next;
    console.log(`[kiosk-sim] navigate (${reason}): ${next}`);
    try {
      await page.goto(next, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const shown = await page.evaluate(() => window.location.href).catch(() => '(unknown)');
      console.log(`[kiosk-sim] shown: ${shown}`);
    } catch (e) {
      console.log(`[kiosk-sim] goto failed: ${(e && e.message) || String(e)}`);
    }
  };

  // Navigate to initial URL without triggering "same url" short-circuit.
  currentUrl = '';
  await goto(readEffectiveUrl(chibaDir), 'start');

  let pending = false;
  const scheduleReload = async (reason) => {
    if (pending) return;
    pending = true;
    await sleep(80);
    pending = false;
    await goto(readEffectiveUrl(chibaDir), reason);
  };

  const safeWatch = (p, label) => {
    try {
      fs.watch(p, () => void scheduleReload(label));
      console.log(`[kiosk-sim] watching: ${p}`);
      return true;
    } catch (e) {
      console.log(`[kiosk-sim] watch failed (${p}): ${(e && e.message) || String(e)}`);
      return false;
    }
  };

  safeWatch(chibaDir, 'dir-change');

  // Poll /tmp restart signal because fs.watch on /tmp can be flaky across platforms.
  let lastRestartMtime = 0;
  while (true) {
    try {
      const st = fs.statSync(restartSignal);
      const m = st.mtimeMs || 0;
      if (m > lastRestartMtime) {
        lastRestartMtime = m;
        // Clean the signal file like the Pi loop does.
        try {
          fs.unlinkSync(restartSignal);
        } catch {}
        await scheduleReload('restart-signal');
      }
    } catch {
      // ignore
    }
    await sleep(250);
  }
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});

