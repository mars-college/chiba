import {
  LaunchOptionsSchema,
  type DesiredTarget,
  type LaunchOptions,
  type ProfileResource,
  type ResourceSnapshot,
} from "@chiba-cable3/contracts";

export type PlannerSnapshot = Pick<ResourceSnapshot, "profiles">;

export type PlannedAssignment = {
  nodeId: string;
  target: DesiredTarget;
  launch: LaunchOptions;
  source: "direct" | "profile-default" | "profile-node-override";
};

export type PlanError = {
  nodeId: string;
  error: string;
};

export type PlanAssignmentsResult = {
  assignments: PlannedAssignment[];
  errors: PlanError[];
};

function sanitizeLaunch(input: unknown): LaunchOptions {
  const parsed = LaunchOptionsSchema.safeParse(input);
  return parsed.success ? parsed.data : {};
}

function mergeLaunch(...parts: unknown[]): LaunchOptions {
  const merged = Object.assign({}, ...parts);
  return sanitizeLaunch(merged);
}

function canonicalNodeIds(nodeIds: string[]): string[] {
  return Array.from(
    new Set(
      nodeIds
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).sort();
}

function findProfile(snapshot: PlannerSnapshot | undefined, profileId: string): ProfileResource | null {
  if (!snapshot) return null;
  return snapshot.profiles.find((row) => row.id === profileId) ?? null;
}

export function planNodeAssignments(args: {
  nodeIds: string[];
  target: DesiredTarget;
  launch?: LaunchOptions;
  snapshot?: PlannerSnapshot;
}): PlanAssignmentsResult {
  const nodeIds = canonicalNodeIds(args.nodeIds);
  const requestLaunch = sanitizeLaunch(args.launch ?? {});

  if (args.target.kind !== "profile") {
    return {
      assignments: nodeIds.map((nodeId) => ({
        nodeId,
        target: args.target,
        launch: requestLaunch,
        source: "direct",
      })),
      errors: [],
    };
  }

  const profile = findProfile(args.snapshot, args.target.id);
  if (!profile) {
    return {
      assignments: [],
      errors: nodeIds.map((nodeId) => ({
        nodeId,
        error: `profile_not_found:${args.target.id}`,
      })),
    };
  }

  const assignments: PlannedAssignment[] = [];
  const errors: PlanError[] = [];

  for (const nodeId of nodeIds) {
    const nodeOverride = profile.nodes.find((row) => row.nodeId === nodeId);
    const target = nodeOverride?.target ?? profile.defaultTarget ?? null;
    if (!target) {
      errors.push({
        nodeId,
        error: `profile_missing_target:${profile.id}`,
      });
      continue;
    }
    assignments.push({
      nodeId,
      target,
      launch: mergeLaunch(profile.defaults ?? {}, nodeOverride?.launch ?? {}, requestLaunch),
      source: nodeOverride ? "profile-node-override" : "profile-default",
    });
  }

  return { assignments, errors };
}
