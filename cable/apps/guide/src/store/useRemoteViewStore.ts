import { create } from "zustand";
import { DEFAULT_THEME_ID } from "../themes";
import {
  LANDSCAPE_VISIBLE_HOURS,
  TEXT_SCALE_DEFAULT,
  UI_SCALE_DEFAULT,
} from "../constants/guide";
import type { DisplayTuningPayload } from "../components/DisplayTuningPanel";
import type { MemoryStats } from "../components/DebugPanel";
import type {
  GuideChannel,
  MediaDebugStats,
  ProgramSlot,
  RemoteControl,
  RemoteMessage,
  RemoteStatus,
} from "../types/guide";
import type { RemoteControlsStatus } from "../hooks/useRemoteControls";

type GodmodeItem = {
  id: string;
  program: ProgramSlot;
  channel: GuideChannel;
};

type RemotePanel = "remote" | "app" | "input";

type RemoteViewData = {
  status: RemoteStatus;
  uiScale: number;
  textScale: number;
  visibleHours: number;
  activeThemeId: string;
  isRemoteDebug: boolean;
  showGodPanel: boolean;
  filteredGodmodeItems: GodmodeItem[];
  godmodeQuery: string;
  showAppPanel: boolean;
  showInputPanel: boolean;
  hasAppControls: boolean;
  hasKeyboardMouse: boolean;
  hasMicControls: boolean;
  hasSpecialControls: boolean;
  remoteControlsStatus: RemoteControlsStatus;
  remoteControls: RemoteControl[];
  showDebug: boolean;
  memoryStats: MemoryStats | null;
  mediaStats: MediaDebugStats | null;
  dialOverlay: string;
  micEnabled: boolean;
  micStatusLabel: string;
  micToggleDisabled: boolean;
};

type RemoteViewHandlers = {
  onDisplayChange: (payload: DisplayTuningPayload) => void;
  send: (message: RemoteMessage) => void;
  setRemoteGodmodeOpen: (open: boolean) => void;
  setGodmodeQuery: (value: string) => void;
  setDialBuffer: (value: string) => void;
  setRemotePanel: (panel: RemotePanel) => void;
  pushDialDigit: (digit: number) => void;
  handleRemoteControl: (controlId: string, value: number | string | boolean) => void;
  onMicToggle: () => void;
};

type RemoteViewStore = RemoteViewData &
  RemoteViewHandlers & {
    setRemoteViewState: (partial: Partial<RemoteViewData>) => void;
    setRemoteViewHandlers: (partial: Partial<RemoteViewHandlers>) => void;
  };

const noop = () => {};
const noopBool = (_value: boolean) => {};
const noopString = (_value: string) => {};
const noopPanel = (_panel: RemotePanel) => {};
const noopDigit = (_digit: number) => {};
const noopControl = (_id: string, _value: number | string | boolean) => {};
const noopDisplay = (_payload: DisplayTuningPayload) => {};
const noopSend = (_message: RemoteMessage) => {};

export const useRemoteViewStore = create<RemoteViewStore>((set) => ({
  status: "connecting",
  uiScale: UI_SCALE_DEFAULT,
  textScale: TEXT_SCALE_DEFAULT,
  visibleHours: LANDSCAPE_VISIBLE_HOURS,
  activeThemeId: DEFAULT_THEME_ID,
  isRemoteDebug: false,
  showGodPanel: false,
  filteredGodmodeItems: [],
  godmodeQuery: "",
  showAppPanel: false,
  showInputPanel: false,
  hasAppControls: false,
  hasKeyboardMouse: false,
  hasMicControls: false,
  hasSpecialControls: false,
  remoteControlsStatus: "idle",
  remoteControls: [],
  showDebug: false,
  memoryStats: null,
  mediaStats: null,
  dialOverlay: "",
  micEnabled: false,
  micStatusLabel: "Off",
  micToggleDisabled: true,
  onDisplayChange: noopDisplay,
  send: noopSend,
  setRemoteGodmodeOpen: noopBool,
  setGodmodeQuery: noopString,
  setDialBuffer: noopString,
  setRemotePanel: noopPanel,
  pushDialDigit: noopDigit,
  handleRemoteControl: noopControl,
  onMicToggle: noop,
  setRemoteViewState: (partial) => set(partial),
  setRemoteViewHandlers: (partial) => set(partial),
}));
