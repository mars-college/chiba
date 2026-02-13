import {
  ApplyComputationSchema,
  type ApplyComputation,
  type ApplyDependencySet,
  type ApplyNodeIntent,
  type ApplyRequest,
  type NodeInventoryEntry,
} from "@chiba-cable2/contracts";
import { type ResourceStore, type ProfileModeDef } from "./resources.js";

type RuntimeTargetKind = "media" | "playlist" | "block" | "channel";
type RuntimeTarget = { kind: RuntimeTargetKind; id: string };

type DependencyAccumulator = {
  media: Set<string>;
  playlists: Set<string>;
  blocks: Set<string>;
  channels: Set<string>;
  profiles: Set<string>;
};

function createDeps(): DependencyAccumulator {
  return {
    media: new Set<string>(),
    playlists: new Set<string>(),
    blocks: new Set<string>(),
    channels: new Set<string>(),
    profiles: new Set<string>(),
  };
}

function toDependencySet(deps: DependencyAccumulator): ApplyDependencySet {
  return {
    media: Array.from(deps.media).sort(),
    playlists: Array.from(deps.playlists).sort(),
    blocks: Array.from(deps.blocks).sort(),
    channels: Array.from(deps.channels).sort(),
    profiles: Array.from(deps.profiles).sort(),
  };
}

function mergeProfileMode(base: ProfileModeDef, override: ProfileModeDef | undefined): ProfileModeDef {
  return {
    ...base,
    ...(override ?? {}),
    prefetch_targets:
      (override?.prefetch_targets && override.prefetch_targets.length > 0)
        ? override.prefetch_targets
        : (base.prefetch_targets ?? []),
    prefetch_channels:
      (override?.prefetch_channels && override.prefetch_channels.length > 0)
        ? override.prefetch_channels
        : (base.prefetch_channels ?? []),
  };
}

function resolveMedia(
  mediaId: string,
  store: ResourceStore,
  deps: DependencyAccumulator,
  warnings: string[]
): void {
  if (!store.mediaById[mediaId]) {
    warnings.push(`missing_media:${mediaId}`);
    return;
  }
  deps.media.add(mediaId);
}

function resolvePlaylist(
  playlistId: string,
  store: ResourceStore,
  deps: DependencyAccumulator,
  warnings: string[],
  visiting: Set<string> = new Set<string>()
): void {
  if (visiting.has(playlistId)) {
    warnings.push(`playlist_cycle:${playlistId}`);
    return;
  }
  const playlist = store.playlistsById[playlistId];
  if (!playlist) {
    warnings.push(`missing_playlist:${playlistId}`);
    return;
  }
  visiting.add(playlistId);
  deps.playlists.add(playlistId);

  for (const item of playlist.items) {
    if (item.media) {
      resolveMedia(item.media, store, deps, warnings);
      continue;
    }
    if (item.playlist) {
      resolvePlaylist(item.playlist, store, deps, warnings, visiting);
      continue;
    }
    if (item.source) {
      warnings.push(`inline_playlist_source:${playlistId}`);
    }
  }
  visiting.delete(playlistId);
}

function resolveBlock(
  blockId: string,
  store: ResourceStore,
  deps: DependencyAccumulator,
  warnings: string[]
): void {
  const block = store.blocksById[blockId];
  if (!block) {
    warnings.push(`missing_block:${blockId}`);
    return;
  }
  deps.blocks.add(blockId);

  if (block.playlist) {
    resolvePlaylist(block.playlist, store, deps, warnings);
  }

  for (const item of block.items ?? []) {
    if (item.media) resolveMedia(item.media, store, deps, warnings);
    if (item.playlist) resolvePlaylist(item.playlist, store, deps, warnings);
    if (item.source) warnings.push(`inline_block_source:${blockId}`);
  }

  if (block.programs.length > 0) {
    warnings.push(`legacy_block_programs:${blockId}`);
  }
}

function resolveChannel(
  channelId: string,
  store: ResourceStore,
  deps: DependencyAccumulator,
  warnings: string[]
): void {
  const channel = store.channelsById[channelId];
  if (!channel) {
    warnings.push(`missing_channel:${channelId}`);
    return;
  }
  deps.channels.add(channelId);

  if (channel.blocks.length > 0) {
    for (const blockId of channel.blocks) {
      resolveBlock(blockId, store, deps, warnings);
    }
    return;
  }

  if (channel.programs.length > 0) {
    warnings.push(`legacy_channel_programs:${channelId}`);
  }
}

function buildNodeIntentForTarget(args: {
  nodeId: string;
  request: ApplyRequest;
  deps: DependencyAccumulator;
}): ApplyNodeIntent {
  const { nodeId, request, deps } = args;
  const cacheMediaIds = Array.from(deps.media).sort();

  switch (request.target) {
    case "media":
      return {
        nodeId,
        target: { kind: "media", id: request.id },
        mediaId: request.id,
        mode: "gallery",
        cacheMediaIds,
        notes: [],
      };
    case "playlist":
      return {
        nodeId,
        target: { kind: "playlist", id: request.id },
        playlistId: request.id,
        mode: "gallery",
        cacheMediaIds,
        notes: [],
      };
    case "block":
      return {
        nodeId,
        target: { kind: "block", id: request.id },
        blockId: request.id,
        mode: "gallery",
        cacheMediaIds,
        notes: [],
      };
    case "channel":
      return {
        nodeId,
        target: { kind: "channel", id: request.id },
        channelId: request.id,
        mode: "gallery",
        cacheMediaIds,
        notes: [],
      };
    case "profile":
      return {
        nodeId,
        target: { kind: "profile", id: request.id },
        cacheMediaIds,
        notes: [],
      };
  }
}

function parseRuntimeTarget(input: string): RuntimeTarget | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const idx = trimmed.indexOf(":");
  if (idx <= 0 || idx >= trimmed.length - 1) return null;
  const kindRaw = trimmed.slice(0, idx).trim();
  const id = trimmed.slice(idx + 1).trim();
  if (!id) return null;
  if (
    kindRaw === "media" ||
    kindRaw === "playlist" ||
    kindRaw === "block" ||
    kindRaw === "channel"
  ) {
    return { kind: kindRaw, id };
  }
  return null;
}

function resolveRuntimeTargetDependencies(args: {
  target: RuntimeTarget;
  store: ResourceStore;
  deps: DependencyAccumulator;
  warnings: string[];
}): void {
  const { target, store, deps, warnings } = args;
  if (target.kind === "media") {
    resolveMedia(target.id, store, deps, warnings);
    return;
  }
  if (target.kind === "playlist") {
    resolvePlaylist(target.id, store, deps, warnings);
    return;
  }
  if (target.kind === "block") {
    resolveBlock(target.id, store, deps, warnings);
    return;
  }
  resolveChannel(target.id, store, deps, warnings);
}

function resolveProfileTarget(mode: ProfileModeDef): RuntimeTarget | null {
  if (mode.target_kind && mode.target_id) {
    return { kind: mode.target_kind, id: mode.target_id };
  }
  if (mode.channel) {
    return { kind: "channel", id: mode.channel };
  }
  return null;
}

function resolveTargetDependencies(args: {
  request: ApplyRequest;
  store: ResourceStore;
  deps: DependencyAccumulator;
  warnings: string[];
}): void {
  const { request, store, deps, warnings } = args;

  switch (request.target) {
    case "media": {
      if (!store.mediaById[request.id]) {
        throw new Error(`Unknown media id: ${request.id}`);
      }
      resolveMedia(request.id, store, deps, warnings);
      return;
    }
    case "playlist": {
      if (!store.playlistsById[request.id]) {
        throw new Error(`Unknown playlist id: ${request.id}`);
      }
      resolvePlaylist(request.id, store, deps, warnings);
      return;
    }
    case "block": {
      if (!store.blocksById[request.id]) {
        throw new Error(`Unknown block id: ${request.id}`);
      }
      resolveBlock(request.id, store, deps, warnings);
      return;
    }
    case "channel": {
      if (!store.channelsById[request.id]) {
        throw new Error(`Unknown channel id: ${request.id}`);
      }
      resolveChannel(request.id, store, deps, warnings);
      return;
    }
    case "profile": {
      if (!store.profilesById[request.id]) {
        throw new Error(`Unknown profile id: ${request.id}`);
      }
      deps.profiles.add(request.id);
      return;
    }
  }
}

export function buildApplyComputation(args: {
  request: ApplyRequest;
  inventory: NodeInventoryEntry[];
  store: ResourceStore;
}): ApplyComputation {
  const inventoryNodeIds = new Set(args.inventory.map((entry) => entry.id));
  const requestedNodeIds = args.request.nodeIds ?? [];
  const unknownRequestedNodeIds = requestedNodeIds.filter(
    (nodeId) => !inventoryNodeIds.has(nodeId)
  );

  const selectedNodeIds =
    requestedNodeIds.length > 0
      ? args.inventory
          .filter((entry) => requestedNodeIds.includes(entry.id))
          .map((entry) => entry.id)
      : args.inventory.map((entry) => entry.id);

  const warnings: string[] = [];
  const notes: string[] = [];
  const globalDeps = createDeps();
  const nodeIntents: ApplyNodeIntent[] = [];

  if (args.request.target !== "profile") {
    resolveTargetDependencies({
      request: args.request,
      store: args.store,
      deps: globalDeps,
      warnings,
    });

    for (const nodeId of selectedNodeIds) {
      nodeIntents.push(
        buildNodeIntentForTarget({
          nodeId,
          request: args.request,
          deps: globalDeps,
        })
      );
    }
  } else {
    const profile = args.store.profilesById[args.request.id];
    if (!profile) {
      throw new Error(`Unknown profile id: ${args.request.id}`);
    }

    globalDeps.profiles.add(profile.id);

    for (const nodeId of selectedNodeIds) {
      const nodeDeps = createDeps();
      const merged = mergeProfileMode(profile.defaults, profile.pis[nodeId]);
      const resolvedTarget = resolveProfileTarget(merged);

      if (resolvedTarget) {
        resolveRuntimeTargetDependencies({
          target: resolvedTarget,
          store: args.store,
          deps: nodeDeps,
          warnings,
        });
        resolveRuntimeTargetDependencies({
          target: resolvedTarget,
          store: args.store,
          deps: globalDeps,
          warnings,
        });
      }

      for (const prefetchChannelId of merged.prefetch_channels ?? []) {
        resolveChannel(prefetchChannelId, args.store, nodeDeps, warnings);
        resolveChannel(prefetchChannelId, args.store, globalDeps, warnings);
      }
      for (const token of merged.prefetch_targets ?? []) {
        const target = parseRuntimeTarget(token);
        if (!target) {
          warnings.push(`invalid_prefetch_target:${profile.id}:${nodeId}:${token}`);
          continue;
        }
        resolveRuntimeTargetDependencies({
          target,
          store: args.store,
          deps: nodeDeps,
          warnings,
        });
        resolveRuntimeTargetDependencies({
          target,
          store: args.store,
          deps: globalDeps,
          warnings,
        });
      }

      nodeIntents.push({
        nodeId,
        mode: merged.mode,
        target: resolvedTarget ?? { kind: "profile", id: profile.id },
        channelId:
          resolvedTarget?.kind === "channel" ? resolvedTarget.id : merged.channel,
        blockId: resolvedTarget?.kind === "block" ? resolvedTarget.id : undefined,
        playlistId: resolvedTarget?.kind === "playlist" ? resolvedTarget.id : undefined,
        mediaId: resolvedTarget?.kind === "media" ? resolvedTarget.id : undefined,
        profileParams: merged as unknown as Record<string, unknown>,
        cacheMediaIds: Array.from(nodeDeps.media).sort(),
        notes: [],
      });
    }
  }

  if (selectedNodeIds.length === 0) {
    notes.push("No selected nodes matched the inventory.");
  }
  if (unknownRequestedNodeIds.length > 0) {
    warnings.push(
      `unknown_nodes:${unknownRequestedNodeIds.sort().join(",")}`
    );
  }

  const computation = {
    request: args.request,
    createdAt: Date.now(),
    selectedNodeIds,
    dependencies: toDependencySet(globalDeps),
    nodeIntents,
    warnings: Array.from(new Set(warnings)).sort(),
    notes,
  } satisfies ApplyComputation;

  return ApplyComputationSchema.parse(computation);
}
