export type ProgramSlot = {
  title: string;
  subtitle?: string;
  tag?: string;
  url?: string;
  durationSec?: number;
  start: number;
  span: number;
  end: number;
};

export type GuideChannel = {
  id: string;
  number: string;
  name: string;
  callSign: string;
  description?: string;
  accent: string;
  previewUrl?: string;
  audioUrl?: string;
  audioVolume?: number;
  audioOffsetMinSec?: number;
  audioOffsetMaxSec?: number;
  schedule: ProgramSlot[];
};

export type GuideIndex = {
  generatedAt: number;
  slotMinutes: number;
  slotCount: number;
  startTime: string;
  timeSlots: string[];
  channels: GuideChannel[];
};

export type PlayerMeta = {
  title: string;
  subtitle?: string;
  channelName?: string;
  callSign?: string;
};

export type MediaDebugStats = {
  uptimeSec: number;
  active: number;
  requests: number;
  completed: number;
  bytesSent: number;
  bytesRequested: number;
  errors: number;
  lastRequestAt?: number | null;
  topPaths?: Array<{
    path: string;
    requests: number;
    bytes: number;
    lastAt: number;
  }>;
};

export type DisplaySettings = {
  scale?: number;
  textScale?: number;
  hours?: number;
  theme?: string;
};

export type AudioSettings = {
  volume: number;
  muted: boolean;
};

export type MediaKind = "image" | "video" | "audio" | "iframe";

export type PreloadEntry = {
  url: string;
  kind: MediaKind;
  status: "loading" | "ready" | "error";
  element: HTMLElement;
  lastUsed: number;
};

export type RemoteControl =
  | {
      id: string;
      label: string;
      type: "range";
      min: number;
      max: number;
      step?: number;
      value?: number;
    }
  | {
      id: string;
      label: string;
      type: "select";
      options: { value: string; label: string }[];
      value?: string;
    }
  | {
      id: string;
      label: string;
      type: "toggle";
      value?: boolean;
    }
  | {
      id: string;
      label: string;
      type: "button";
    };

export type RemoteMessage =
  | { type: "nav"; dir: "up" | "down" | "left" | "right" }
  | { type: "channel"; dir: "up" | "down" }
  | { type: "tune"; number: string }
  | { type: "dial"; value: string; committed?: boolean }
  | { type: "volume"; dir: "up" | "down" }
  | { type: "mute"; muted?: boolean }
  | { type: "select" }
  | { type: "guide" }
  | { type: "info" }
  | { type: "app"; appId?: string | null }
  | { type: "index" }
  | {
      type: "now";
      channelId?: string;
      number?: string;
      title?: string;
      url?: string;
    }
  | { type: "godselect"; channelId: string; url: string }
  | { type: "controls"; appId: string; controls: RemoteControl[] }
  | {
      type: "control";
      appId: string;
      controlId: string;
      value?: number | string | boolean;
    }
  | {
      type: "display";
      scale?: number | null;
      textScale?: number | null;
      hours?: number | null;
      theme?: string | null;
      screenId?: string | null;
    };

export type RemoteStatus = "connecting" | "open" | "closed";

export type ViewMode = "guide" | "remote" | "art";
