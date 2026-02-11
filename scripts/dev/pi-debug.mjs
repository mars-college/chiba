#!/usr/bin/env node
/**
 * Quick Pi inspection helper for "what is it receiving / applying?"
 *
 * Examples:
 *   node scripts/dev/pi-debug.mjs --host mars26.local --screenId lower-east-1
 *   node scripts/dev/pi-debug.mjs --host 100.128.0.121 --screenId lower-east-1
 *
 * Optional:
 *   API_KEY=... node scripts/dev/pi-debug.mjs --host ... --screenId ...
 */

const args = process.argv.slice(2);
const getArg = (k, def = null) => {
  const i = args.indexOf(k);
  if (i >= 0) return args[i + 1] ?? def;
  const m = args.find((a) => a.startsWith(`${k}=`));
  if (m) return m.slice(k.length + 1);
  return def;
};

const host = String(getArg("--host", "") ?? "").trim();
if (!host) {
  console.error("Missing --host");
  process.exit(2);
}

const screenId = String(getArg("--screenId", getArg("--screen", "")) ?? "").trim();
const channelIdArg = String(getArg("--channelId", getArg("--channel", "")) ?? "").trim();
const nodePort = Number(getArg("--nodePort", "8080"));
const cablePort = Number(getArg("--cablePort", "8787"));
const guidePort = Number(getArg("--guidePort", "5173"));
const apiKey = String(process.env.API_KEY ?? process.env.CHIBA_API_KEY ?? "").trim();

const fmt = (v) => (v === null || v === undefined ? "(null)" : String(v));

async function httpJson(url, opts = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, opts);
    const text = await res.text().catch(() => "");
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
      json,
      text: json ? null : text.slice(0, 300),
    };
  } catch (e) {
    return { ok: false, status: null, ms: null, json: null, text: (e && e.message) || String(e) };
  }
}

function section(title) {
  process.stdout.write(`\n== ${title} ==\n`);
}

section("Node /status (8080)");
const nodeStatus = await httpJson(`http://${host}:${nodePort}/status`);
console.log(`ok=${nodeStatus.ok} status=${fmt(nodeStatus.status)} ms=${fmt(nodeStatus.ms)}`);
if (nodeStatus.json?.data?.node) {
  const n = nodeStatus.json.data.node;
  console.log(`version=${fmt(n.version)} ip=${fmt(n.ip)} name=${fmt(n.friendlyName)} kioskUrl=${fmt(n.kioskUrl)}`);
} else {
  console.log(nodeStatus.text ?? "");
}

section("Node /kiosk-url (8080)");
const nodeKiosk = await httpJson(`http://${host}:${nodePort}/kiosk-url`);
console.log(`ok=${nodeKiosk.ok} status=${fmt(nodeKiosk.status)} ms=${fmt(nodeKiosk.ms)}`);
if (nodeKiosk.json?.data?.url !== undefined) {
  console.log(`kioskUrl=${fmt(nodeKiosk.json.data.url)}`);
} else {
  console.log(nodeKiosk.text ?? "");
}

const kioskUrlRaw =
  (nodeKiosk.json?.data?.url !== undefined ? nodeKiosk.json?.data?.url : null) ??
  (nodeStatus.json?.data?.node?.kioskUrl ?? null) ??
  "";

const kioskUrlParams = (() => {
  const raw = String(kioskUrlRaw ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const entries = Array.from(u.searchParams.entries()).sort((a, b) =>
      String(a[0]).localeCompare(String(b[0]))
    );
    return { href: u.href, entries };
  } catch {
    return null;
  }
})();

section("Node kiosk URL params (parsed)");
if (!kioskUrlParams) {
  console.log("(none / unparseable)");
} else {
  console.log(`href=${kioskUrlParams.href}`);
  if (!kioskUrlParams.entries.length) {
    console.log("(no query params)");
  } else {
    for (const [k, v] of kioskUrlParams.entries) {
      console.log(`${k}=${v}`);
    }
  }
}

section("Cable /api/version (8787)");
const cableV = await httpJson(`http://${host}:${cablePort}/api/version`);
console.log(`ok=${cableV.ok} status=${fmt(cableV.status)} ms=${fmt(cableV.ms)}`);
if (cableV.json) {
  console.log(JSON.stringify(cableV.json, null, 2));
} else {
  console.log(cableV.text ?? "");
}

let kioskStateJson = null;
if (screenId) {
  section(`Cable /api/kiosk/state (screenId=${screenId})`);
  const kioskState = await httpJson(
    `http://${host}:${cablePort}/api/kiosk/state?screenId=${encodeURIComponent(screenId)}`
  );
  console.log(`ok=${kioskState.ok} status=${fmt(kioskState.status)} ms=${fmt(kioskState.ms)}`);
  if (kioskState.json) {
    kioskStateJson = kioskState.json;
    console.log(JSON.stringify(kioskState.json, null, 2));
  } else {
    console.log(kioskState.text ?? "");
  }
} else {
  section("Cable /api/kiosk/state");
  console.log("Skipped (no --screenId provided).");
}

const effectiveChannel = (() => {
  if (channelIdArg) return channelIdArg;
  const st = kioskStateJson?.record?.state ?? null;
  if (st?.channel) return String(st.channel);
  const entries = kioskUrlParams?.entries ?? [];
  const found = entries.find(([k]) => k === "channel");
  if (found && found[1]) return String(found[1]);
  return "";
})();

section("Effective channel");
console.log(effectiveChannel ? effectiveChannel : "(none)");

if (effectiveChannel) {
  section("Cable /api/stash/status (8787)");
  const stashStatus = await httpJson(
    `http://${host}:${cablePort}/api/stash/status?channelId=${encodeURIComponent(effectiveChannel)}`
  );
  console.log(`ok=${stashStatus.ok} status=${fmt(stashStatus.status)} ms=${fmt(stashStatus.ms)}`);
  if (stashStatus.json?.ok) {
    console.log(
      `cached=${fmt(stashStatus.json.cached)} total=${fmt(stashStatus.json.total)}`
    );
  } else {
    console.log(stashStatus.text ?? (stashStatus.json ? JSON.stringify(stashStatus.json, null, 2) : ""));
  }

  section("Cable /api/cache/status (8787)");
  const cacheStatus = await httpJson(
    `http://${host}:${cablePort}/api/cache/status?channelId=${encodeURIComponent(effectiveChannel)}`
  );
  console.log(`ok=${cacheStatus.ok} status=${fmt(cacheStatus.status)} ms=${fmt(cacheStatus.ms)}`);
  if (cacheStatus.json?.ok) {
    console.log(
      `cached=${fmt(cacheStatus.json.cached)} total=${fmt(cacheStatus.json.total)}`
    );
  } else {
    console.log(cacheStatus.text ?? (cacheStatus.json ? JSON.stringify(cacheStatus.json, null, 2) : ""));
  }
}

section("Guide HTTP (5173)");
const guideHead = await httpJson(`http://${host}:${guidePort}/api/index`);
console.log(`GET /api/index via guide port ok=${guideHead.ok} status=${fmt(guideHead.status)} ms=${fmt(guideHead.ms)}`);
if (!guideHead.ok) {
  console.log(guideHead.text ?? "");
}

if (apiKey) {
  section("Auth Note");
  console.log("API_KEY is set in this shell; node POST routes require it if the Pi was bootstrapped with an API key.");
  console.log("This script currently only reads public routes. For POST /kiosk-url use:");
  console.log(`curl -sS -X POST http://${host}:${nodePort}/kiosk-url -H 'Authorization: Bearer ***' -H 'content-type: application/json' -d '{\"url\":\"...\"}'`);
}
