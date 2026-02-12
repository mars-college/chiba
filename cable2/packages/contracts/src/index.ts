import { z } from "zod";

export const APPLY_TARGETS = [
  "profile",
  "channel",
  "block",
  "playlist",
  "media",
] as const;

export type ApplyTarget = (typeof APPLY_TARGETS)[number];
export const ApplyTargetSchema = z.enum(APPLY_TARGETS);

export const NodeRegistryDefaultsSchema = z
  .object({
    user: z.string().optional(),
    controller_url: z.string().optional(),
    guide_port: z.number().int().positive().optional(),
    node_port: z.number().int().positive().optional(),
    server_port: z.number().int().positive().optional(),
    api_key: z.string().optional(),
  })
  .passthrough();

export const NodeRegistryPiEntrySchema = z
  .object({
    host: z.string().optional(),
    ip: z.string().optional(),
    node_name: z.string().optional(),
    orientation: z.string().optional(),
    display_rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
    guide_port: z.number().int().positive().optional(),
    node_port: z.number().int().positive().optional(),
    server_port: z.number().int().positive().optional(),
    api_key: z.string().optional(),
  })
  .passthrough();

export const NodeRegistrySchema = z
  .object({
    defaults: NodeRegistryDefaultsSchema.optional(),
    pis: z.record(NodeRegistryPiEntrySchema).optional(),
  })
  .passthrough();

export type NodeRegistry = z.infer<typeof NodeRegistrySchema>;

export const NodeInventoryEntrySchema = z.object({
  id: z.string(),
  host: z.string().optional(),
  ip: z.string().optional(),
  nodeName: z.string(),
  orientation: z.string().optional(),
  displayRotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  guidePort: z.number().int().positive(),
  nodePort: z.number().int().positive(),
  serverPort: z.number().int().positive(),
  apiKey: z.string().nullable(),
});

export type NodeInventoryEntry = z.infer<typeof NodeInventoryEntrySchema>;

export const ApplyRequestSchema = z.object({
  target: ApplyTargetSchema,
  id: z.string().min(1),
  nodeIds: z.array(z.string()).optional(),
  dryRun: z.boolean().default(false),
});

export type ApplyRequest = z.infer<typeof ApplyRequestSchema>;

export const ApplyPlanSchema = z.object({
  request: ApplyRequestSchema,
  createdAt: z.number().int(),
  selectedNodeIds: z.array(z.string()),
  mode: z.enum(["planned_only", "dispatch_not_implemented"]),
  notes: z.array(z.string()),
});

export type ApplyPlan = z.infer<typeof ApplyPlanSchema>;

export const ApplyDependencySetSchema = z.object({
  media: z.array(z.string()),
  playlists: z.array(z.string()),
  blocks: z.array(z.string()),
  channels: z.array(z.string()),
  profiles: z.array(z.string()),
});

export type ApplyDependencySet = z.infer<typeof ApplyDependencySetSchema>;

export const ApplyNodeIntentSchema = z.object({
  nodeId: z.string(),
  mode: z.enum(["guide", "gallery"]).optional(),
  target: z.object({
    kind: z.enum(["profile", "channel", "block", "playlist", "media"]),
    id: z.string(),
  }),
  channelId: z.string().optional(),
  blockId: z.string().optional(),
  playlistId: z.string().optional(),
  mediaId: z.string().optional(),
  profileParams: z.record(z.unknown()).optional(),
  cacheMediaIds: z.array(z.string()),
  notes: z.array(z.string()),
});

export type ApplyNodeIntent = z.infer<typeof ApplyNodeIntentSchema>;

export const ApplyComputationSchema = z.object({
  request: ApplyRequestSchema,
  createdAt: z.number().int(),
  selectedNodeIds: z.array(z.string()),
  dependencies: ApplyDependencySetSchema,
  nodeIntents: z.array(ApplyNodeIntentSchema),
  warnings: z.array(z.string()),
  notes: z.array(z.string()),
});

export type ApplyComputation = z.infer<typeof ApplyComputationSchema>;

export const NodeApplyRequestSchema = z.object({
  request: ApplyRequestSchema,
  intent: ApplyNodeIntentSchema,
});

export type NodeApplyRequest = z.infer<typeof NodeApplyRequestSchema>;

export const NodeApplyResponseSchema = z.object({
  ok: z.boolean(),
  nodeId: z.string(),
  appliedAt: z.number().int(),
  target: z.object({
    kind: z.enum(["profile", "channel", "block", "playlist", "media"]),
    id: z.string(),
  }),
  warning: z.string().optional(),
});

export type NodeApplyResponse = z.infer<typeof NodeApplyResponseSchema>;

export const ApplyDispatchResultSchema = z.object({
  nodeId: z.string(),
  ok: z.boolean(),
  status: z.number().nullable(),
  ms: z.number().nullable(),
  error: z.string().nullable(),
  response: NodeApplyResponseSchema.nullable(),
});

export type ApplyDispatchResult = z.infer<typeof ApplyDispatchResultSchema>;

export const DesiredStateRecordSchema = z.object({
  nodeId: z.string(),
  updatedAt: z.number().int(),
  operationId: z.string(),
  request: ApplyRequestSchema,
  intent: ApplyNodeIntentSchema,
});

export type DesiredStateRecord = z.infer<typeof DesiredStateRecordSchema>;

export const NodeStatusReportSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  platform: z.string(),
  hostname: z.string(),
  seenAt: z.number().int(),
  capabilities: z.record(z.boolean()),
  process: z.object({
    pid: z.number().int().positive(),
    uptimeSec: z.number().int().nonnegative(),
    memory: z.object({
      rss: z.number().int().nonnegative(),
      heapTotal: z.number().int().nonnegative(),
      heapUsed: z.number().int().nonnegative(),
      external: z.number().int().nonnegative(),
      arrayBuffers: z.number().int().nonnegative(),
    }),
  }),
  apply: z.object({
    lastAppliedAt: z.number().int().nullable(),
  }),
  cache: z.object({
    dir: z.string(),
    bytes: z.number().int().nonnegative(),
    fileCount: z.number().int().nonnegative(),
  }),
  runtime: z
    .object({
      nodeAgentVersion: z.string().nullable().optional(),
      deployGitSha: z.string().nullable().optional(),
      cableVersion: z.string().nullable().optional(),
      cableGitSha: z.string().nullable().optional(),
      cableReachable: z.boolean().optional(),
      cableStatus: z.number().int().nullable().optional(),
      cableCheckedAt: z.number().int().optional(),
      kioskUrl: z.string().nullable().optional(),
    })
    .optional(),
});

export type NodeStatusReport = z.infer<typeof NodeStatusReportSchema>;

export const GuideSlotSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  start: z.number().int(),
  span: z.number().int(),
  end: z.number().int(),
  url: z.string(),
});

export type GuideSlot = z.infer<typeof GuideSlotSchema>;

export const GuideChannelSchema = z.object({
  id: z.string(),
  name: z.string(),
  number: z.string(),
  schedule: z.array(GuideSlotSchema),
});

export type GuideChannel = z.infer<typeof GuideChannelSchema>;

export const GuideIndexSchema = z.object({
  generatedAt: z.number().int(),
  slotMinutes: z.number().int(),
  slotCount: z.number().int(),
  channels: z.array(GuideChannelSchema),
});

export type GuideIndex = z.infer<typeof GuideIndexSchema>;

export const CatalogKindSchema = z.enum([
  "media",
  "playlist",
  "block",
  "channel",
  "profile",
]);

export type CatalogKind = z.infer<typeof CatalogKindSchema>;

export const CatalogItemSchema = z.object({
  kind: CatalogKindSchema,
  id: z.string(),
  filePath: z.string(),
  title: z.string().optional(),
});

export type CatalogItem = z.infer<typeof CatalogItemSchema>;

export const CatalogSchema = z.object({
  media: z.array(CatalogItemSchema),
  playlists: z.array(CatalogItemSchema),
  blocks: z.array(CatalogItemSchema),
  channels: z.array(CatalogItemSchema),
  profiles: z.array(CatalogItemSchema),
});

export type Catalog = z.infer<typeof CatalogSchema>;
