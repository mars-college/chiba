#!/usr/bin/env node
/**
 * Print a Markdown reference for Cable Guide launch params + profile keys.
 *
 * Source-of-truth:
 * - Guide query params: cable/apps/guide/src/constants/params.ts
 * - Profile keys (ops apply-mode): cable/apps/server/src/ops-apply-mode.ts (CableModeDefaults + buildKioskUrl)
 */

import fs from "node:fs";
import path from "node:path";

function readText(p) {
  return fs.readFileSync(p, "utf-8");
}

function findRepoRoot() {
  let cur = process.cwd();
  for (let i = 0; i < 10; i += 1) {
    if (fs.existsSync(path.join(cur, "scripts", "pis", "registry.toml"))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return process.cwd();
}

function extractGuideParams(ts) {
  const out = [];

  // PARAM_FOO = "bar"
  for (const m of ts.matchAll(/export const (PARAM_[A-Z0-9_]+)\s*=\s*"([^"]+)"\s*;/g)) {
    out.push({ name: m[1], keys: [m[2]] });
  }

  // PARAM_FOO_KEYS = ["a", "b"] as const;
  for (const m of ts.matchAll(
    /export const (PARAM_[A-Z0-9_]+_KEYS)\s*=\s*\[([^\]]*)\]\s*as const\s*;/g
  )) {
    const raw = m[2];
    const keys = Array.from(raw.matchAll(/"([^"]+)"/g)).map((x) => x[1]);
    out.push({ name: m[1], keys });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function extractCableModeKeys(ts) {
  const m = ts.match(/export type CableModeDefaults\s*=\s*\{([\s\S]*?)\};/m);
  if (!m) return [];
  const body = m[1];
  const keys = [];
  for (const line of body.split("\n")) {
    const mm = line.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*)\??:\s*/);
    if (mm) keys.push(mm[1]);
  }
  return keys;
}

function extractBuildKioskMappings(ts) {
  const m = ts.match(/export function buildKioskUrl\([\s\S]*?\)\s*:\s*string\s*\{([\s\S]*?)\n\}/m);
  if (!m) return [];
  const body = m[1];

  // Grab explicit searchParams.set('param', ...) occurrences.
  const params = new Set();
  for (const mm of body.matchAll(/searchParams\.set\(\s*'([^']+)'\s*,/g)) {
    params.add(mm[1]);
  }

  return Array.from(params).sort();
}

function mdEscape(s) {
  return String(s).replaceAll("|", "\\|");
}

function printMd(opts) {
  const lines = [];
  lines.push("# Cable Launch Options");
  lines.push("");
  lines.push("Generated from source-of-truth code:");
  lines.push(`- \`${opts.guideParamsPath}\``);
  lines.push(`- \`${opts.opsApplyModePath}\``);
  lines.push("");

  lines.push("## Profile Keys (ops apply-mode)");
  lines.push("");
  lines.push("These keys are supported in `cable/config/profiles/*.toml` under `[defaults.cable]` and `[pis.<id>.cable]`.");
  lines.push("");
  lines.push("| Key | Meaning |");
  lines.push("| --- | --- |");
  for (const k of opts.modeKeys) {
    let meaning = "";
    if (k === "mode") meaning = "`gallery` enables gallery autoplay behavior.";
    if (k === "theme") meaning = "Guide theme id.";
    if (k === "nosplash") meaning = "Skip splash screen (`nosplash=1`).";
    if (k === "lock") meaning = "Lock guide navigation (`lock=1`). In gallery mode, `lock=false` emits `lock=0`.";
    if (k === "qr") meaning = "Show/hide Remote QR (`qr=0` hides, `qr=1` forces on).";
    if (k === "channel") meaning = "Pinned channel id/number (`channel=...`).";
    if (k === "ambient_channels") meaning = "If `channel` is unset/blank, choose a per-Pi channel from this pool (launcher behavior; not a guide query param).";
    if (k === "playlist") meaning = "Playlist autoplay inside gallery mode (`playlist=1`).";
    if (k === "scale") meaning = "UI scale (`scale=...`).";
    if (k === "text_scale") meaning = "Text scale (`textScale=...`).";
    if (k === "hours") meaning = "How many hours to show in the guide (`hours=...`).";
    lines.push(`| \`${mdEscape(k)}\` | ${meaning || ""} |`);
  }
  lines.push("");

  lines.push("## Guide Query Params");
  lines.push("");
  lines.push("This is the canonical list of query params the guide recognizes.");
  lines.push("");
  lines.push("| Const | Query Key(s) |");
  lines.push("| --- | --- |");
  for (const p of opts.guideParams) {
    lines.push(
      `| \`${mdEscape(p.name)}\` | ${p.keys.map((k) => `\`${mdEscape(k)}\``).join(", ")} |`
    );
  }
  lines.push("");

  lines.push("## Kiosk URL Emits");
  lines.push("");
  lines.push("These are the query params `ops:apply-mode` may emit when building kiosk URLs:");
  lines.push("");
  lines.push(opts.kioskParams.map((p) => `- \`${p}\``).join("\n"));
  lines.push("");

  return lines.join("\n");
}

function main() {
  const repoRoot = findRepoRoot();
  const guideParamsPath = path.join(repoRoot, "cable/apps/guide/src/constants/params.ts");
  const opsApplyModePath = path.join(repoRoot, "cable/apps/server/src/ops-apply-mode.ts");

  const guideTs = readText(guideParamsPath);
  const opsTs = readText(opsApplyModePath);

  const guideParams = extractGuideParams(guideTs);
  const modeKeys = extractCableModeKeys(opsTs);
  const kioskParams = extractBuildKioskMappings(opsTs);

  process.stdout.write(
    printMd({
      guideParamsPath: path.relative(repoRoot, guideParamsPath),
      opsApplyModePath: path.relative(repoRoot, opsApplyModePath),
      guideParams,
      modeKeys,
      kioskParams,
    })
  );
}

main();
