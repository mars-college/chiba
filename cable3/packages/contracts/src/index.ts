import { z } from "zod";

export const NamespaceSchema = z.string().min(1);
export type Namespace = z.infer<typeof NamespaceSchema>;

export const ControllerIdSchema = z.string().min(1);
export type ControllerId = z.infer<typeof ControllerIdSchema>;

export const TargetKindSchema = z.enum([
  "media",
  "playlist",
  "block",
  "channel",
  "profile",
]);
export type TargetKind = z.infer<typeof TargetKindSchema>;

export const DesiredTargetSchema = z.object({
  kind: TargetKindSchema,
  id: z.string().min(1),
});
export type DesiredTarget = z.infer<typeof DesiredTargetSchema>;

export const LaunchModeSchema = z.enum(["guide", "gallery"]);
export type LaunchMode = z.infer<typeof LaunchModeSchema>;

export const HudModeSchema = z.enum(["always", "start", "never"]);
export type HudMode = z.infer<typeof HudModeSchema>;

export const DisplayRotateSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);
export type DisplayRotate = z.infer<typeof DisplayRotateSchema>;

export const LaunchOptionsSchema = z
  .object({
    mode: LaunchModeSchema.optional(),
    lock: z.boolean().optional(),
    qr: z.boolean().optional(),
    nosplash: z.boolean().optional(),
    hudMode: HudModeSchema.optional(),
    hudSec: z.number().positive().optional(),
    theme: z.string().min(1).optional(),
    displayRotate: DisplayRotateSchema.optional(),
  })
  .strict();
export type LaunchOptions = z.infer<typeof LaunchOptionsSchema>;

export const ScreenAssignmentSchema = z
  .object({
    screenId: z.string().min(1),
    namespace: NamespaceSchema,
    controllerId: ControllerIdSchema,
    operationId: z.string().min(1),
    expectedRevision: z.number().int().nonnegative().optional(),
    target: DesiredTargetSchema,
    launch: LaunchOptionsSchema.default({}),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type ScreenAssignment = z.infer<typeof ScreenAssignmentSchema>;

export const RegistryNodeSchema = z
  .object({
    registryId: z.string().min(1).optional(),
    nodeId: z.string().min(1),
    host: z.string().optional(),
    ip: z.string().optional(),
    nodeName: z.string().optional(),
    orientation: z.string().optional(),
    displayRotate: DisplayRotateSchema.optional(),
    guidePort: z.number().int().positive().optional(),
    nodePort: z.number().int().positive().optional(),
    serverPort: z.number().int().positive().optional(),
    apiKey: z.string().optional(),
    createdAt: z.number().int().nonnegative().optional(),
    updatedAt: z.number().int().nonnegative().optional(),
  })
  .strict();
export type RegistryNode = z.infer<typeof RegistryNodeSchema>;

export const NodeInventoryWriteSchema = z
  .object({
    registryId: z.string().min(1),
    nodeId: z.string().min(1),
    host: z.string().optional(),
    ip: z.string().optional(),
    nodeName: z.string().optional(),
    orientation: z.string().optional(),
    displayRotate: DisplayRotateSchema.optional(),
    guidePort: z.number().int().positive().optional(),
    nodePort: z.number().int().positive().optional(),
    serverPort: z.number().int().positive().optional(),
    apiKey: z.string().optional(),
  })
  .strict();
export type NodeInventoryWrite = z.infer<typeof NodeInventoryWriteSchema>;

export const NodeConnectivityStatusSchema = z.enum([
  "online",
  "degraded",
  "offline",
]);
export type NodeConnectivityStatus = z.infer<typeof NodeConnectivityStatusSchema>;

export const NodeConnectivitySnapshotSchema = z
  .object({
    registryId: z.string().min(1),
    nodeId: z.string().min(1),
    namespace: NamespaceSchema,
    dnsOk: z.boolean(),
    pingOk: z.boolean(),
    sshOk: z.boolean(),
    nodeApiOk: z.boolean(),
    cableApiOk: z.boolean(),
    connectivityScore: z.number().int().min(0).max(5),
    connectivityTotal: z.literal(5).default(5),
    status: NodeConnectivityStatusSchema,
    latencyMs: z.number().int().nonnegative().nullable(),
    errorSummary: z.string().optional(),
    checkedAt: z.number().int().nonnegative(),
  })
  .strict();
export type NodeConnectivitySnapshot = z.infer<
  typeof NodeConnectivitySnapshotSchema
>;

export const RegistrySnapshotSchema = z
  .object({
    registryId: z.string().min(1),
    sourcePath: z.string().min(1),
    importedAt: z.number().int().nonnegative(),
    nodes: z.array(RegistryNodeSchema),
  })
  .strict();
export type RegistrySnapshot = z.infer<typeof RegistrySnapshotSchema>;

export const MediaResourceSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().optional(),
    artist: z.string().optional(),
    description: z.string().optional(),
    sourceType: z.enum(["path", "url"]),
    sourceValue: z.string().min(1),
    thumbnailUrl: z.string().optional(),
    thumbnailObjectKey: z.string().optional(),
    cache: z.boolean().default(true),
  })
  .strict();
export type MediaResource = z.infer<typeof MediaResourceSchema>;

export const PlaylistItemSchema = z
  .object({
    index: z.number().int().nonnegative(),
    mediaId: z.string().optional(),
    playlistId: z.string().optional(),
    durationSec: z.number().positive().optional(),
  })
  .strict();
export type PlaylistItem = z.infer<typeof PlaylistItemSchema>;

export const PlaylistResourceSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().optional(),
    artist: z.string().optional(),
    description: z.string().optional(),
    items: z.array(PlaylistItemSchema),
  })
  .strict();
export type PlaylistResource = z.infer<typeof PlaylistResourceSchema>;

export const BlockItemSchema = z
  .object({
    index: z.number().int().nonnegative(),
    mediaId: z.string().optional(),
    playlistId: z.string().optional(),
    durationSec: z.number().positive().optional(),
  })
  .strict();
export type BlockItem = z.infer<typeof BlockItemSchema>;

export const BlockResourceSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().optional(),
    mode: z.enum(["loop", "once", "clocked"]).optional(),
    items: z.array(BlockItemSchema),
  })
  .strict();
export type BlockResource = z.infer<typeof BlockResourceSchema>;

export const ChannelResourceSchema = z
  .object({
    id: z.string().min(1),
    number: z.string().optional(),
    name: z.string().optional(),
    blockIds: z.array(z.string().min(1)),
  })
  .strict();
export type ChannelResource = z.infer<typeof ChannelResourceSchema>;

export const ProfileNodeAssignmentSchema = z
  .object({
    nodeId: z.string().min(1),
    target: DesiredTargetSchema,
    launch: LaunchOptionsSchema.default({}),
  })
  .strict();
export type ProfileNodeAssignment = z.infer<typeof ProfileNodeAssignmentSchema>;

export const ProfileResourceSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().optional(),
    defaults: LaunchOptionsSchema.default({}),
    defaultTarget: DesiredTargetSchema.optional(),
    nodes: z.array(ProfileNodeAssignmentSchema),
  })
  .strict();
export type ProfileResource = z.infer<typeof ProfileResourceSchema>;

export const ResourceImportPayloadSchema = z
  .object({
    media: z.array(MediaResourceSchema).default([]),
    playlists: z.array(PlaylistResourceSchema).default([]),
    blocks: z.array(BlockResourceSchema).default([]),
    channels: z.array(ChannelResourceSchema).default([]),
    profiles: z.array(ProfileResourceSchema).default([]),
  })
  .strict();
export type ResourceImportPayload = z.infer<typeof ResourceImportPayloadSchema>;

export const ResourceSnapshotSchema = ResourceImportPayloadSchema;
export type ResourceSnapshot = z.infer<typeof ResourceSnapshotSchema>;

export const IngestProgressSchema = z
  .object({
    current: z.number().int().nonnegative(),
    total: z.number().int().positive(),
    percent: z.number().min(0).max(100),
    message: z.string().optional(),
  })
  .strict();
export type IngestProgress = z.infer<typeof IngestProgressSchema>;

export const IngestJobKindSchema = z.enum([
  "upload",
  "youtube",
  "eden_collection",
]);
export type IngestJobKind = z.infer<typeof IngestJobKindSchema>;

export const IngestJobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
]);
export type IngestJobStatus = z.infer<typeof IngestJobStatusSchema>;

export const IngestJobSchema = z
  .object({
    id: z.string().min(1),
    kind: IngestJobKindSchema,
    status: IngestJobStatusSchema,
    createdAt: z.number().int().nonnegative(),
    startedAt: z.number().int().nonnegative().optional(),
    finishedAt: z.number().int().nonnegative().optional(),
    updatedAt: z.number().int().nonnegative(),
    progress: IngestProgressSchema,
    result: z.record(z.unknown()).optional(),
    error: z.string().optional(),
  })
  .strict();
export type IngestJob = z.infer<typeof IngestJobSchema>;

export const IngestYouTubeRequestSchema = z
  .object({
    url: z.string().url(),
    mediaId: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    artist: z.string().min(1).optional(),
    cache: z.boolean().optional(),
  })
  .strict();
export type IngestYouTubeRequest = z.infer<typeof IngestYouTubeRequestSchema>;

export const IngestEdenCollectionRequestSchema = z
  .object({
    input: z.string().min(1).optional(),
    url: z.string().url().optional(),
    collectionId: z.string().min(1).optional(),
    db: z.enum(["PROD", "STAGE"]).optional(),
    playlistId: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
  })
  .strict();
export type IngestEdenCollectionRequest = z.infer<
  typeof IngestEdenCollectionRequestSchema
>;

export const IngestUploadMetadataSchema = z
  .object({
    artist: z.string().min(1).max(256).optional(),
    description: z.string().min(1).max(4_000).optional(),
  })
  .strict();
export type IngestUploadMetadata = z.infer<typeof IngestUploadMetadataSchema>;

export const RuntimePhaseSchema = z.enum([
  "idle",
  "warming",
  "ready",
  "activating",
  "active",
  "degraded",
  "error",
]);
export type RuntimePhase = z.infer<typeof RuntimePhaseSchema>;

export const ScreenConditionTypeSchema = z.enum([
  "Accepted",
  "ManifestResolved",
  "Warming",
  "Ready",
  "Activated",
  "Degraded",
  "Error",
]);
export type ScreenConditionType = z.infer<typeof ScreenConditionTypeSchema>;

export const ScreenConditionSchema = z
  .object({
    type: ScreenConditionTypeSchema,
    status: z.boolean(),
    reason: z.string().optional(),
    message: z.string().optional(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type ScreenCondition = z.infer<typeof ScreenConditionSchema>;

export const ApplyScreenAssignmentRequestSchema = z
  .object({
    screenId: z.string().min(1),
    namespace: NamespaceSchema,
    controllerId: ControllerIdSchema,
    operationId: z.string().min(1),
    expectedRevision: z.number().int().nonnegative().optional(),
    target: DesiredTargetSchema,
    launch: LaunchOptionsSchema.default({}),
  })
  .strict();
export type ApplyScreenAssignmentRequest = z.infer<
  typeof ApplyScreenAssignmentRequestSchema
>;

export const ApplyScreenAssignmentResponseSchema = z
  .object({
    ok: z.boolean(),
    screenId: z.string().min(1),
    namespace: NamespaceSchema,
    desiredRevision: z.number().int().nonnegative(),
    operationId: z.string().min(1),
    conflict: z
      .object({
        expectedRevision: z.number().int().nonnegative(),
        actualRevision: z.number().int().nonnegative(),
      })
      .optional(),
    conditions: z.array(ScreenConditionSchema),
  })
  .strict();
export type ApplyScreenAssignmentResponse = z.infer<
  typeof ApplyScreenAssignmentResponseSchema
>;

export const NodeRuntimeReportV1Schema = z
  .object({
    nodeId: z.string().min(1),
    namespace: NamespaceSchema,
    desiredRevision: z.number().int().nonnegative().nullable(),
    activeRevision: z.number().int().nonnegative().nullable(),
    phase: RuntimePhaseSchema,
    backend: z.enum(["chromium", "mpv", "unknown"]).default("unknown"),
    currentTarget: DesiredTargetSchema.optional(),
    currentItemId: z.string().optional(),
    cacheReady: z.number().int().nonnegative().optional(),
    cacheTotal: z.number().int().nonnegative().optional(),
    errorCode: z.string().optional(),
    errorMessage: z.string().optional(),
    updatedAt: z.number().int().nonnegative(),
    raw: z.record(z.unknown()).optional(),
  })
  .strict();
export type NodeRuntimeReportV1 = z.infer<typeof NodeRuntimeReportV1Schema>;

export const NodeRuntimePlaybackStateSchema = z.enum([
  "playing",
  "paused",
  "stopped",
  "unknown",
]);
export type NodeRuntimePlaybackState = z.infer<
  typeof NodeRuntimePlaybackStateSchema
>;

export const NodeRuntimePlaybackSchema = z
  .object({
    state: NodeRuntimePlaybackStateSchema,
    positionSec: z.number().nonnegative().nullable().optional(),
    durationSec: z.number().nonnegative().nullable().optional(),
    progressPercent: z.number().min(0).max(100).nullable().optional(),
    path: z.string().optional(),
    itemId: z.string().optional(),
    mediaId: z.string().optional(),
    title: z.string().optional(),
    artist: z.string().optional(),
    description: z.string().optional(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type NodeRuntimePlayback = z.infer<typeof NodeRuntimePlaybackSchema>;

export const NodeRuntimeStatusSnapshotSchema = z
  .object({
    phase: RuntimePhaseSchema,
    desiredRevision: z.number().int().nonnegative().nullable(),
    activeRevision: z.number().int().nonnegative().nullable(),
    backend: z.enum(["chromium", "mpv", "unknown"]).default("unknown"),
    currentTarget: DesiredTargetSchema.nullable(),
    currentItemId: z.string().nullable(),
    cacheReady: z.number().int().nonnegative(),
    cacheTotal: z.number().int().nonnegative(),
    warnings: z.array(z.string()),
    error: z.string().nullable(),
    playback: NodeRuntimePlaybackSchema.nullable().optional(),
  })
  .strict();
export type NodeRuntimeStatusSnapshot = z.infer<
  typeof NodeRuntimeStatusSnapshotSchema
>;

export const NodeCacheFileSchema = z
  .object({
    name: z.string().min(1),
    size: z.number().int().nonnegative(),
    mtimeMs: z.number().nonnegative(),
  })
  .strict();
export type NodeCacheFile = z.infer<typeof NodeCacheFileSchema>;

export const NodeCacheSummarySchema = z
  .object({
    dir: z.string().min(1),
    files: z.array(NodeCacheFileSchema),
    bytes: z.number().int().nonnegative(),
    fileCount: z.number().int().nonnegative(),
  })
  .strict();
export type NodeCacheSummary = z.infer<typeof NodeCacheSummarySchema>;

export const NodeRuntimeCacheInspectResponseSchema = z
  .object({
    ok: z.literal(true),
    nodeId: z.string().min(1),
    cache: NodeCacheSummarySchema,
  })
  .strict();
export type NodeRuntimeCacheInspectResponse = z.infer<
  typeof NodeRuntimeCacheInspectResponseSchema
>;

export const NodeRuntimeCacheClearResponseSchema = z
  .object({
    ok: z.literal(true),
    nodeId: z.string().min(1),
    deletedFiles: z.number().int().nonnegative(),
    deletedBytes: z.number().int().nonnegative(),
    before: NodeCacheSummarySchema,
    after: NodeCacheSummarySchema,
  })
  .strict();
export type NodeRuntimeCacheClearResponse = z.infer<
  typeof NodeRuntimeCacheClearResponseSchema
>;

export const OpsNodeCacheInspectResponseSchema = z
  .object({
    ok: z.literal(true),
    nodeId: z.string().min(1),
    registryId: z.string().min(1),
    namespace: z.string().min(1),
    host: z.string().min(1),
    nodePort: z.number().int().positive(),
    cache: NodeCacheSummarySchema,
  })
  .strict();
export type OpsNodeCacheInspectResponse = z.infer<
  typeof OpsNodeCacheInspectResponseSchema
>;

export const OpsNodeCacheClearResponseSchema = z
  .object({
    ok: z.literal(true),
    nodeId: z.string().min(1),
    registryId: z.string().min(1),
    namespace: z.string().min(1),
    host: z.string().min(1),
    nodePort: z.number().int().positive(),
    deletedFiles: z.number().int().nonnegative(),
    deletedBytes: z.number().int().nonnegative(),
    before: NodeCacheSummarySchema,
    after: NodeCacheSummarySchema,
  })
  .strict();
export type OpsNodeCacheClearResponse = z.infer<
  typeof OpsNodeCacheClearResponseSchema
>;

export const OpsNodeRuntimeStatusResponseSchema = z
  .object({
    ok: z.literal(true),
    nodeId: z.string().min(1),
    registryId: z.string().min(1),
    namespace: z.string().min(1),
    host: z.string().min(1),
    nodePort: z.number().int().positive(),
    status: NodeRuntimeStatusSnapshotSchema,
  })
  .strict();
export type OpsNodeRuntimeStatusResponse = z.infer<
  typeof OpsNodeRuntimeStatusResponseSchema
>;

export const NodeRuntimeInputActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("key"),
      key: z.string().min(1),
      repeat: z.number().int().positive().max(20).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("text"),
      text: z.string().min(1).max(4_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("mouse_move"),
      x: z.number().int().nonnegative(),
      y: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("mouse_click"),
      button: z.enum(["left", "middle", "right"]).default("left"),
      repeat: z.number().int().positive().max(20).optional(),
    })
    .strict(),
]);
export type NodeRuntimeInputAction = z.infer<typeof NodeRuntimeInputActionSchema>;

export const NodeRuntimeInputRequestSchema = z
  .object({
    action: NodeRuntimeInputActionSchema,
  })
  .strict();
export type NodeRuntimeInputRequest = z.infer<
  typeof NodeRuntimeInputRequestSchema
>;

export const NodeRuntimeInputResponseSchema = z
  .object({
    ok: z.literal(true),
    nodeId: z.string().min(1),
    backend: z.enum(["chromium", "mpv", "unknown"]).default("unknown"),
    action: NodeRuntimeInputActionSchema,
    command: z.array(z.string().min(1)),
    code: z.number().int(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
  })
  .strict();
export type NodeRuntimeInputResponse = z.infer<
  typeof NodeRuntimeInputResponseSchema
>;

export const OpsNodeInputResponseSchema = z
  .object({
    ok: z.literal(true),
    nodeId: z.string().min(1),
    registryId: z.string().min(1),
    namespace: z.string().min(1),
    host: z.string().min(1),
    nodePort: z.number().int().positive(),
    backend: z.enum(["chromium", "mpv", "unknown"]).default("unknown"),
    action: NodeRuntimeInputActionSchema,
    command: z.array(z.string().min(1)),
    code: z.number().int(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
  })
  .strict();
export type OpsNodeInputResponse = z.infer<typeof OpsNodeInputResponseSchema>;

export const ScreenAssignmentStatusResponseSchema = z
  .object({
    ok: z.boolean(),
    screenId: z.string().min(1),
    namespace: NamespaceSchema,
    desired: z
      .object({
        revision: z.number().int().nonnegative(),
        target: DesiredTargetSchema,
        launch: LaunchOptionsSchema,
        controllerId: ControllerIdSchema,
        operationId: z.string().min(1),
        updatedAt: z.number().int().nonnegative(),
      })
      .nullable(),
    runtime: NodeRuntimeReportV1Schema.nullable(),
    conditions: z.array(ScreenConditionSchema),
  })
  .strict();
export type ScreenAssignmentStatusResponse = z.infer<
  typeof ScreenAssignmentStatusResponseSchema
>;
