import type { LaunchOptions } from "@chiba-cable3/contracts";

export type OpsApplyTargetKind =
  | "profile"
  | "channel"
  | "block"
  | "playlist"
  | "media";

export function normalizeOpsApplyLaunch(args: {
  target: OpsApplyTargetKind;
  launch: LaunchOptions;
  modeExplicit: boolean;
}): LaunchOptions {
  const next: LaunchOptions = { ...args.launch };
  if (!args.modeExplicit && args.target !== "profile" && !next.mode) {
    next.mode = "gallery";
  }
  return next;
}
