import {
  ApplyComputationSchema,
  type ApplyComputation,
  type ApplyDependencySet,
  type ApplyNodeIntent,
  type ApplyRequest,
  type NodeInventoryEntry,
} from "@chiba-cable2/contracts";
import { type ResourceStore, type ProfileModeDef } from "./resources.js";

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
    prefetch_channels:
      (override?.prefetch_channels && override.prefetch_channels.length > 0)
        ? override.prefetch_channels
        : (base.prefetch_channels ?? []),
  };
}

function resolvePlaylist(
  playlistId: string,
  store: ResourceStore,
  deps: DependencyAccumulator,
  warnings: string[]
): void {
  const playlist = store.playlistsById[playlistId];
  if (!playlist) {
    warnings.push(`missing_playlist:${playlistId}`);
    return;
  }
  deps.playlists.add(playlistId);

  for (const item of playlist.items) {
    if (item.media) {
      if (store.mediaById[item.media]) {
        deps.media.add(item.media);
      } else {
        warnings.push(`missing_media:${item.media}`);
      }
      continue;
    }
    if (item.source) {
      warnings.push(`inline_playlist_source:${playlistId}`);
    }
  }
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

  if (block.programs.length > 0) {
    warnings.push(`inline_block_programs:${blockId}`);
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
        cacheMediaIds,
        notes: [],
      };
    case "playlist":
      return {
        nodeId,
        target: { kind: "playlist", id: request.id },
        playlistId: request.id,
        cacheMediaIds,
        notes: [],
      };
    case "block":
      return {
        nodeId,
        target: { kind: "block", id: request.id },
        blockId: request.id,
        cacheMediaIds,
        notes: [],
      };
    case "channel":
      return {
        nodeId,
        target: { kind: "channel", id: request.id },
        channelId: request.id,
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
      deps.media.add(request.id);
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

      if (merged.channel) {
        resolveChannel(merged.channel, args.store, nodeDeps, warnings);
        resolveChannel(merged.channel, args.store, globalDeps, warnings);
      }

      for (const prefetchChannelId of merged.prefetch_channels ?? []) {
        resolveChannel(prefetchChannelId, args.store, nodeDeps, warnings);
        resolveChannel(prefetchChannelId, args.store, globalDeps, warnings);
      }

      nodeIntents.push({
        nodeId,
        mode: merged.mode,
        target: merged.channel
          ? { kind: "channel", id: merged.channel }
          : { kind: "profile", id: profile.id },
        channelId: merged.channel,
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
