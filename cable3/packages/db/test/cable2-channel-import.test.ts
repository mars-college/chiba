import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { buildCable2ChannelImportPayload } from "../src/cable2-channel-import.js";

async function writeTomlFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content.trimStart(), "utf8");
}

test("buildCable2ChannelImportPayload maps embed source paths to channel embed URLs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "c3-c2-embed-"));
  const configRoot = path.join(root, "config");

  await writeTomlFile(
    path.join(configRoot, "media", "m-ai.toml"),
    `
id = "m-ai"
title = "AI Village"
[source]
type = "url"
value = "/embed/ai-village"
`
  );

  await writeTomlFile(
    path.join(configRoot, "playlists", "pl-ai.toml"),
    `
id = "pl-ai"
name = "AI playlist"
[[item]]
media = "m-ai"
duration_slots = 2
`
  );

  await writeTomlFile(
    path.join(configRoot, "blocks", "blk-ai.toml"),
    `
id = "blk-ai"
mode = "loop"
playlist = "pl-ai"
`
  );

  await writeTomlFile(
    path.join(configRoot, "channels", "ai-village.toml"),
    `
id = "ai-village"
number = "066"
name = "AI Village"
blocks = [ "blk-ai" ]
[[program]]
title = "AI Village"
  [program.source]
  type = "url"
  value = "/embed/ai-village"
[embed]
url = "https://theaidigest.org/village"
`
  );

  const built = await buildCable2ChannelImportPayload({
    configRoot,
    channelIds: ["ai-village"],
    slotDurationSec: 10,
    guideBaseUrl: "http://192.168.0.117:5173",
  });

  assert.deepEqual(built.warnings, []);
  assert.equal(built.payload.channels.length, 1);
  assert.equal(built.payload.blocks.length, 1);
  assert.equal(built.payload.playlists.length, 1);
  assert.equal(built.payload.media.length, 1);
  assert.equal(built.payload.media[0]?.sourceValue, "https://theaidigest.org/village");
  assert.equal(built.payload.playlists[0]?.items[0]?.durationSec, 20);
});

test("buildCable2ChannelImportPayload follows nested playlist references and absolutizes relative URLs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "c3-c2-nested-"));
  const configRoot = path.join(root, "config");

  await writeTomlFile(
    path.join(configRoot, "media", "m-weather.toml"),
    `
id = "m-weather"
title = "Weather"
[source]
type = "url"
value = "/weatherstar"
`
  );

  await writeTomlFile(
    path.join(configRoot, "playlists", "pl-b.toml"),
    `
id = "pl-b"
name = "Playlist B"
[[item]]
media = "m-weather"
`
  );

  await writeTomlFile(
    path.join(configRoot, "playlists", "pl-a.toml"),
    `
id = "pl-a"
name = "Playlist A"
[[item]]
playlist = "pl-b"
`
  );

  await writeTomlFile(
    path.join(configRoot, "blocks", "blk-weather.toml"),
    `
id = "blk-weather"
playlist = "pl-a"
`
  );

  await writeTomlFile(
    path.join(configRoot, "channels", "weatherstar.toml"),
    `
id = "weatherstar"
number = "137"
name = "WeatherStar"
blocks = [ "blk-weather" ]
`
  );

  const built = await buildCable2ChannelImportPayload({
    configRoot,
    channelIds: ["weatherstar"],
    guideBaseUrl: "http://192.168.0.117:5173",
  });

  assert.deepEqual(built.warnings, []);
  assert.equal(built.payload.channels.length, 1);
  assert.equal(built.payload.blocks.length, 1);
  assert.equal(built.payload.playlists.length, 2);
  assert.equal(built.payload.media.length, 1);
  assert.equal(
    built.payload.media[0]?.sourceValue,
    "http://192.168.0.117:5173/weatherstar"
  );
});

test("buildCable2ChannelImportPayload rewrites loopback URL media to guide host when provided", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "c3-c2-loopback-"));
  const configRoot = path.join(root, "config");

  await writeTomlFile(
    path.join(configRoot, "media", "m-nebula.toml"),
    `
id = "m-nebula"
title = "Nebula Relay"
[source]
type = "url"
value = "http://localhost:8790/?ws=ws://localhost:8787/ws&appId=gen-art"
`
  );

  await writeTomlFile(
    path.join(configRoot, "playlists", "pl-nebula.toml"),
    `
id = "pl-nebula"
[[item]]
media = "m-nebula"
`
  );

  await writeTomlFile(
    path.join(configRoot, "blocks", "blk-nebula.toml"),
    `
id = "blk-nebula"
playlist = "pl-nebula"
`
  );

  await writeTomlFile(
    path.join(configRoot, "channels", "nebula.toml"),
    `
id = "nebula"
name = "Nebula"
blocks = [ "blk-nebula" ]
`
  );

  const built = await buildCable2ChannelImportPayload({
    configRoot,
    channelIds: ["nebula"],
    guideBaseUrl: "http://192.168.0.117:5173",
  });

  assert.deepEqual(built.warnings, []);
  assert.equal(built.payload.media.length, 1);
  assert.equal(
    built.payload.media[0]?.sourceValue,
    "http://192.168.0.117:8790/?ws=ws%3A%2F%2F192.168.0.117%3A8787%2Fws&appId=gen-art"
  );
});

test("buildCable2ChannelImportPayload repairs malformed http// URL scheme", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "c3-c2-scheme-"));
  const configRoot = path.join(root, "config");

  await writeTomlFile(
    path.join(configRoot, "media", "m-weather.toml"),
    `
id = "m-weather"
title = "Weather"
[source]
type = "url"
value = "http//100.72.1.58:5173/weatherstar"
`
  );

  await writeTomlFile(
    path.join(configRoot, "playlists", "pl-weather.toml"),
    `
id = "pl-weather"
[[item]]
media = "m-weather"
`
  );

  await writeTomlFile(
    path.join(configRoot, "blocks", "blk-weather.toml"),
    `
id = "blk-weather"
playlist = "pl-weather"
`
  );

  await writeTomlFile(
    path.join(configRoot, "channels", "weatherstar.toml"),
    `
id = "weatherstar"
blocks = [ "blk-weather" ]
`
  );

  const built = await buildCable2ChannelImportPayload({
    configRoot,
    channelIds: ["weatherstar"],
  });

  assert.equal(built.payload.media[0]?.sourceValue, "http://100.72.1.58:5173/weatherstar");
});
