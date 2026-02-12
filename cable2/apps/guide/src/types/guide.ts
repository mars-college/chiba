export type ProgramSlot = {
  title: string;
  subtitle?: string;
  tag?: string;
  artist?: string;
  infoTitle?: string;
  description?: string;
  hudMode?: "always" | "start" | "never";
  hudShowSec?: number;
  url?: string;
  durationSec?: number;
  remoteControls?: RemoteRegistration[];
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
  artist?: string;
  infoTitle?: string;
  description?: string;
  hudMode?: "always" | "start" | "never";
  hudShowSec?: number;
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

// Persisted on the cable server and pushed to running kiosk clients over WS.
export type KioskState = {
  mode?: "gallery" | "guide";
  channel?: string;
  lock?: boolean;
  qr?: boolean;
  playlist?: boolean;
  nosplash?: boolean;
  theme?: string;
  scale?: number;
  textScale?: number;
  hours?: number;
};

export type KioskStateRecord = {
  updatedAt: number;
  state: KioskState;
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

export type RemoteRegistration = "mic" | "app" | "keyboard_mouse";

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
  | {
      type: "app";
      appId?: string | null;
      remoteControls?: RemoteRegistration[];
    }
  | { type: "index" }
  | { type: "mouse"; action: "move"; dx: number; dy: number }
  | { type: "mouse"; action: "click" }
  | {
      type: "keyboard";
      action: "text";
      text: string;
    }
  | {
      type: "keyboard";
      action: "backspace";
      count?: number;
    }
  | {
      type: "keyboard";
      action: "key";
      key: "Enter" | "Escape" | "Tab";
    }
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
    }
  | {
      type: "kiosk_state";
      screenId: string;
      record: KioskStateRecord | null;
    }
  | {
      type: "open_art";
      screenId: string;
      channelId: string;
      index: number;
    }
  | {
      type: "mic";
      action: "offer" | "answer" | "ice" | "stop";
      sessionId: string;
      sdp?: string;
      candidate?: RTCIceCandidateInit;
      from: "remote" | "guide";
    };

export type RemoteStatus = "connecting" | "open" | "closed";

export type ViewMode = "guide" | "remote" | "art";
