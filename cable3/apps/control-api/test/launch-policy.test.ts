import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOpsApplyLaunch } from "../src/launch-policy.js";

test("defaults non-profile targets to gallery when mode is omitted", () => {
  const launch = normalizeOpsApplyLaunch({
    target: "channel",
    launch: {},
    modeExplicit: false,
  });
  assert.equal(launch.mode, "gallery");
});

test("keeps explicit mode on non-profile targets", () => {
  const launch = normalizeOpsApplyLaunch({
    target: "media",
    launch: { mode: "guide", nosplash: true },
    modeExplicit: true,
  });
  assert.equal(launch.mode, "guide");
  assert.equal(launch.nosplash, true);
});

test("does not force gallery defaults for profile applies", () => {
  const launch = normalizeOpsApplyLaunch({
    target: "profile",
    launch: {},
    modeExplicit: false,
  });
  assert.equal(launch.mode, undefined);
});
