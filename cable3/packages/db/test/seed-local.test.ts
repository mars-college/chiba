import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { buildLocalSeedPayload } from "../src/seed-local.js";

test("buildLocalSeedPayload includes local assets and Jensen channel resources", async () => {
  const assetsRoot = await mkdtemp(path.join(os.tmpdir(), "c3-seed-assets-"));
  await writeFile(path.join(assetsRoot, "Eden.png"), "fake-png", "utf8");
  await writeFile(path.join(assetsRoot, "Eden.mp4"), "fake-mp4", "utf8");
  await writeFile(path.join(assetsRoot, "README.txt"), "ignore", "utf8");

  const payload = await buildLocalSeedPayload({ assetsRoot });

  const localAssetMedia = payload.media.filter((row) =>
    row.id.startsWith("m-asset-")
  );
  assert.equal(localAssetMedia.length, 2);
  assert.ok(localAssetMedia.some((row) => row.id === "m-asset-eden-png"));
  assert.ok(localAssetMedia.some((row) => row.id === "m-asset-eden-mp4"));

  const localPlaylist = payload.playlists.find((row) => row.id === "pl-local-assets");
  assert.ok(localPlaylist);
  assert.equal(localPlaylist?.items.length, 2);
  const durationByMediaId = new Map(
    (localPlaylist?.items ?? []).map((item) => [item.mediaId, item.durationSec])
  );
  assert.equal(durationByMediaId.get("m-asset-eden-png"), 15);
  assert.equal(durationByMediaId.get("m-asset-eden-mp4"), undefined);

  const jensenChannel = payload.channels.find((row) => row.id === "jensen-art");
  assert.ok(jensenChannel);
  assert.deepEqual(jensenChannel?.blockIds, [
    "blk-jensen-1",
    "blk-jensen-2",
    "blk-jensen-3",
  ]);

  const jensenPlaylists = payload.playlists.filter((row) =>
    row.id.startsWith("pl-jensen-")
  );
  assert.equal(jensenPlaylists.length, 3);
  for (const playlist of jensenPlaylists) {
    assert.equal(playlist.items.length, 1);
    assert.equal(playlist.items[0]?.durationSec, 1800);
  }

  const homeAssistantMedia = payload.media.find((row) => row.id === "m-home-assistant");
  assert.ok(homeAssistantMedia);
  assert.equal(homeAssistantMedia?.sourceType, "url");
  assert.equal(homeAssistantMedia?.sourceValue, "/home-assistant");

  const homeAssistantChannel = payload.channels.find((row) => row.id === "home-assistant");
  assert.ok(homeAssistantChannel);
  assert.equal(homeAssistantChannel?.number, "188");
  assert.deepEqual(homeAssistantChannel?.blockIds, ["blk-home-assistant"]);
});
