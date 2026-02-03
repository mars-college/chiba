import { create } from "zustand";
import type { CSSProperties, RefObject } from "react";
import type { MemoryStats } from "../components/DebugPanel";
import type {
  GuideChannel,
  GuideIndex,
  MediaDebugStats,
  MediaKind,
  PlayerMeta,
  ProgramSlot,
} from "../types/guide";

type GuideViewData = {
  gridStyle: CSSProperties;
  now: Date;
  selectedChannel?: GuideChannel;
  selectedProgram?: ProgramSlot | null;
  playerOpen: boolean;
  playerReady: boolean;
  playerSurfaceRef: RefObject<HTMLDivElement | null>;
  remoteCursor?: { x: number; y: number; visible: boolean; pressed: boolean };
  hasKeyboardMouse: boolean;
  hasPreviewMedia: boolean;
  posterImageReady: boolean;
  previewContainerRef: RefObject<HTMLDivElement | null>;
  progressValue: number;
  indexData: GuideIndex;
  visibleStartSlot: number;
  visibleSlotCount: number;
  slotCount: number;
  selectedCol: number;
  currentSlotIndex: number;
  channels: GuideChannel[];
  activeRow: number;
  isPaused: boolean;
  viewportRef: RefObject<HTMLDivElement | null>;
  rowsRef: RefObject<HTMLDivElement | null>;
  showQr: boolean;
  qrUrl: string;
  playerUrl: string | null;
  playerKind: MediaKind | null;
  playerMeta: PlayerMeta | null;
  showPlayerHud: boolean;
  ambientAudio: {
    url: string;
    volume?: number;
    offsetMinSec?: number;
    offsetMaxSec?: number;
  } | null;
  masterVolume: number;
  masterMuted: boolean;
  showVolumeHud: boolean;
  showDebug: boolean;
  memoryStats: MemoryStats | null;
  mediaStats: MediaDebugStats | null;
  dialOverlay: string;
};

type GuideViewHandlers = {
  setPosterImageReady: (ready: boolean) => void;
  onSelectRow: (row: number) => void;
  onSelectCol: (col: number) => void;
  onOpenProgram: (program: ProgramSlot, channel: GuideChannel) => void;
  onToggleDebug: () => void;
  setPlayerReady: (ready: boolean) => void;
};

type GuideViewStore = GuideViewData &
  GuideViewHandlers & {
    setGuideViewState: (partial: Partial<GuideViewData>) => void;
    setGuideViewHandlers: (partial: Partial<GuideViewHandlers>) => void;
  };

const noop = () => {};
const noopNumber = (_value: number) => {};
const noopProgram = (_program: ProgramSlot, _channel: GuideChannel) => {};
const noopBool = (_value: boolean) => {};
const nullRef = { current: null } as RefObject<HTMLDivElement | null>;

export const useGuideViewStore = create<GuideViewStore>((set) => ({
  gridStyle: {},
  now: new Date(),
  selectedChannel: undefined,
  selectedProgram: null,
  playerOpen: false,
  playerReady: false,
  playerSurfaceRef: nullRef,
  remoteCursor: undefined,
  hasKeyboardMouse: false,
  hasPreviewMedia: false,
  posterImageReady: false,
  previewContainerRef: nullRef,
  progressValue: 0,
  indexData: {
    generatedAt: 0,
    slotMinutes: 30,
    slotCount: 0,
    startTime: "",
    timeSlots: [],
    channels: [],
  },
  visibleStartSlot: 0,
  visibleSlotCount: 0,
  slotCount: 0,
  selectedCol: 0,
  currentSlotIndex: 0,
  channels: [],
  activeRow: 0,
  isPaused: false,
  viewportRef: nullRef,
  rowsRef: nullRef,
  showQr: true,
  qrUrl: "",
  playerUrl: null,
  playerKind: null,
  playerMeta: null,
  showPlayerHud: false,
  ambientAudio: null,
  masterVolume: 1,
  masterMuted: false,
  showVolumeHud: false,
  showDebug: false,
  memoryStats: null,
  mediaStats: null,
  dialOverlay: "",
  setPosterImageReady: noopBool,
  onSelectRow: noopNumber,
  onSelectCol: noopNumber,
  onOpenProgram: noopProgram,
  onToggleDebug: noop,
  setPlayerReady: noopBool,
  setGuideViewState: (partial) => set(partial),
  setGuideViewHandlers: (partial) => set(partial),
}));
