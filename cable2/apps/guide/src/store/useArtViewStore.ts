import { create } from "zustand";
import type { MemoryStats } from "../components/DebugPanel";
import type { GuideChannel, MediaDebugStats } from "../types/guide";

type ArtViewData = {
  channels: GuideChannel[];
  channelId: string | null;
  artIndex: number;
  artPaused: boolean;
  showDebug: boolean;
  memoryStats: MemoryStats | null;
  mediaStats: MediaDebugStats | null;
  dialOverlay: string;
  masterVolume: number;
  masterMuted: boolean;
  showVolumeHud: boolean;
};

type ArtViewStore = ArtViewData & {
  setArtViewState: (partial: Partial<ArtViewData>) => void;
};

export const useArtViewStore = create<ArtViewStore>((set) => ({
  channels: [],
  channelId: null,
  artIndex: 0,
  artPaused: false,
  showDebug: false,
  memoryStats: null,
  mediaStats: null,
  dialOverlay: "",
  masterVolume: 1,
  masterMuted: false,
  showVolumeHud: false,
  setArtViewState: (partial) => set(partial),
}));
