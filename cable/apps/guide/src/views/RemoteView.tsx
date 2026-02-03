import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
} from "react";
import { DebugPanel, type MemoryStats } from "../components/DebugPanel";
import { DialOverlay } from "../components/DialOverlay";
import {
  DisplayTuningPanel,
  type DisplayTuningPayload,
} from "../components/DisplayTuningPanel";
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

type RemoteViewProps = {
  status: RemoteStatus;
  uiScale: number;
  textScale: number;
  visibleHours: number;
  activeThemeId: string;
  onDisplayChange: (payload: DisplayTuningPayload) => void;
  send: (message: RemoteMessage) => void;
  isRemoteDebug: boolean;
  showGodPanel: boolean;
  setRemoteGodmodeOpen: (open: boolean) => void;
  filteredGodmodeItems: GodmodeItem[];
  godmodeQuery: string;
  setGodmodeQuery: (value: string) => void;
  setDialBuffer: (value: string) => void;
  showAppPanel: boolean;
  showInputPanel: boolean;
  hasAppControls: boolean;
  hasKeyboardMouse: boolean;
  hasMicControls: boolean;
  hasSpecialControls: boolean;
  remoteControlsStatus: RemoteControlsStatus;
  remoteControls: RemoteControl[];
  handleRemoteControl: (controlId: string, value: number | string | boolean) => void;
  setRemotePanel: (panel: "remote" | "app" | "input") => void;
  pushDialDigit: (digit: number) => void;
  micEnabled: boolean;
  micStatusLabel: string;
  micToggleDisabled: boolean;
  onMicToggle: () => void;
  showDebug: boolean;
  memoryStats: MemoryStats | null;
  mediaStats: MediaDebugStats | null;
  dialOverlay: string;
};

export function RemoteView({
  status,
  uiScale,
  textScale,
  visibleHours,
  activeThemeId,
  onDisplayChange,
  send,
  isRemoteDebug,
  showGodPanel,
  setRemoteGodmodeOpen,
  filteredGodmodeItems,
  godmodeQuery,
  setGodmodeQuery,
  setDialBuffer,
  showAppPanel,
  showInputPanel,
  hasAppControls,
  hasKeyboardMouse,
  hasMicControls,
  hasSpecialControls,
  remoteControlsStatus,
  remoteControls,
  handleRemoteControl,
  setRemotePanel,
  pushDialDigit,
  micEnabled,
  micStatusLabel,
  micToggleDisabled,
  onMicToggle,
  showDebug,
  memoryStats,
  mediaStats,
  dialOverlay,
}: RemoteViewProps) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const padLastRef = useRef<{ x: number; y: number } | null>(null);
  const padTapRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const keyboardInputRef = useRef<HTMLInputElement | null>(null);
  const [keyboardValue, setKeyboardValue] = useState("");
  const keyboardValueRef = useRef("");

  const startPad = useCallback((clientX: number, clientY: number) => {
    padLastRef.current = { x: clientX, y: clientY };
    padTapRef.current = { x: clientX, y: clientY, time: Date.now() };
  }, []);

  const movePad = useCallback(
    (clientX: number, clientY: number) => {
      const last = padLastRef.current;
      const rect = padRef.current?.getBoundingClientRect();
      if (!last || !rect || !rect.width || !rect.height) return;
      const dx = (clientX - last.x) / rect.width;
      const dy = (clientY - last.y) / rect.height;
      padLastRef.current = { x: clientX, y: clientY };
      if (dx === 0 && dy === 0) return;
      send({ type: "mouse", action: "move", dx, dy });
    },
    [send]
  );

  const endPad = useCallback(
    (clientX: number, clientY: number) => {
      const tap = padTapRef.current;
      padLastRef.current = null;
      padTapRef.current = null;
      if (!tap) return;
      const dt = Date.now() - tap.time;
      const dist = Math.hypot(clientX - tap.x, clientY - tap.y);
      if (dt < 250 && dist < 8) {
        send({ type: "mouse", action: "click" });
      }
    },
    [send]
  );

  const handlePadPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // ignore if pointer capture unsupported
      }
      startPad(event.clientX, event.clientY);
    },
    [startPad]
  );

  const handlePadPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      movePad(event.clientX, event.clientY);
    },
    [movePad]
  );

  const handlePadPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // ignore if pointer capture unsupported
      }
      endPad(event.clientX, event.clientY);
    },
    [endPad]
  );

  const handlePadPointerCancel = useCallback(() => {
    padLastRef.current = null;
    padTapRef.current = null;
  }, []);

  const handlePadTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if ("PointerEvent" in window) return;
      const touch = event.touches[0];
      if (!touch) return;
      event.preventDefault();
      startPad(touch.clientX, touch.clientY);
    },
    [startPad]
  );

  const handlePadTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if ("PointerEvent" in window) return;
      const touch = event.touches[0];
      if (!touch) return;
      event.preventDefault();
      movePad(touch.clientX, touch.clientY);
    },
    [movePad]
  );

  const handlePadTouchEnd = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if ("PointerEvent" in window) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      event.preventDefault();
      endPad(touch.clientX, touch.clientY);
    },
    [endPad]
  );

  const handlePadTouchCancel = useCallback(() => {
    if ("PointerEvent" in window) return;
    padLastRef.current = null;
    padTapRef.current = null;
  }, []);

  const handleKeyboardChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const next = event.currentTarget.value;
      const prev = keyboardValueRef.current;
      if (next === prev) return;
      if (next.startsWith(prev)) {
        const delta = next.slice(prev.length);
        if (delta) {
          send({ type: "keyboard", action: "text", text: delta });
        }
      } else if (prev.startsWith(next)) {
        const count = prev.length - next.length;
        if (count > 0) {
          send({ type: "keyboard", action: "backspace", count });
        }
      } else {
        if (prev.length) {
          send({ type: "keyboard", action: "backspace", count: prev.length });
        }
        if (next) {
          send({ type: "keyboard", action: "text", text: next });
        }
      }
      keyboardValueRef.current = next;
      setKeyboardValue(next);
    },
    [send]
  );

  const handleKeyboardKey = useCallback(
    (key: "Enter" | "Escape" | "Tab") => {
      send({ type: "keyboard", action: "key", key });
    },
    [send]
  );

  const handleKeyboardBackspace = useCallback(() => {
    send({ type: "keyboard", action: "backspace", count: 1 });
  }, [send]);

  useEffect(() => {
    if (!showInputPanel) {
      keyboardValueRef.current = "";
      setKeyboardValue("");
    }
  }, [showInputPanel]);

  return (
    <div
      className={`remote-shell ${hasSpecialControls ? "app-active" : ""} ${
        showGodPanel ? "godmode-active" : ""
      }`}
    >
      <div className="remote-body">
        <div className="remote-top">
          <div className="remote-title">Chiba Cable</div>
          <div className={`remote-status ${status}`}>
            {status === "open" ? "Connected" : "Connecting..."}
          </div>
        </div>

        {isRemoteDebug ? (
          <DisplayTuningPanel
            className="remote-display"
            uiScale={uiScale}
            textScale={textScale}
            visibleHours={visibleHours}
            activeThemeId={activeThemeId}
            onChange={onDisplayChange}
          />
        ) : null}

        {showGodPanel ? (
          <div className="remote-god-panel">
            <div className="remote-god-title">God Mode</div>
            <div className="remote-god-subtitle">
              Pick any program
              {filteredGodmodeItems.length
                ? ` · ${filteredGodmodeItems.length}`
                : ""}
            </div>
            <div className="remote-god-search">
              <input
                className="remote-god-input"
                type="search"
                value={godmodeQuery}
                onChange={(event) => setGodmodeQuery(event.target.value)}
                placeholder="Filter programs"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
              />
              {godmodeQuery ? (
                <button
                  className="remote-god-clear"
                  onClick={() => setGodmodeQuery("")}
                >
                  Clear
                </button>
              ) : null}
            </div>
            <div className="remote-god-list">
              {filteredGodmodeItems.length ? (
                filteredGodmodeItems.map((item) => (
                  <button
                    key={item.id}
                    className="remote-god-item"
                    onClick={() => {
                      if (!item.program.url) return;
                      send({
                        type: "godselect",
                        channelId: item.channel.id,
                        url: item.program.url,
                      });
                      setDialBuffer("");
                      setRemoteGodmodeOpen(false);
                    }}
                  >
                    <div className="remote-god-item-title">
                      {item.program.title}
                    </div>
                    <div className="remote-god-item-meta">
                      {item.channel.number} · {item.channel.name}
                      {item.program.subtitle
                        ? ` · ${item.program.subtitle}`
                        : ""}
                    </div>
                  </button>
                ))
              ) : (
                <div className="remote-god-empty">
                  {godmodeQuery ? "No matches found." : "No media found."}
                </div>
              )}
            </div>
            <button
              className="remote-god-close"
              onClick={() => setRemoteGodmodeOpen(false)}
            >
              Close
            </button>
          </div>
        ) : showAppPanel ? (
          <div className="remote-app">
            <div className="remote-app-title">
              <span>App Controls</span>
            </div>
            <button
              className="remote-app-back"
              onClick={() => setRemotePanel("remote")}
            >
              Back to Remote
            </button>
            {remoteControlsStatus === "loading" ? (
              <div className="remote-app-status">Loading controls…</div>
            ) : null}
            {remoteControlsStatus === "missing" ? (
              <div className="remote-app-status">
                No controls yet. Open the app once.
              </div>
            ) : null}
            {remoteControls.length ? (
              <div className="remote-app-controls">
                {remoteControls.map((control) => {
                  if (control.type === "range") {
                    const value =
                      typeof control.value === "number"
                        ? control.value
                        : control.min;
                    return (
                      <label
                        key={control.id}
                        className="remote-control remote-range"
                      >
                        <span className="remote-control-label">
                          {control.label}
                          <span className="remote-control-value">
                            {value.toFixed(2)}
                          </span>
                        </span>
                        <input
                          type="range"
                          min={control.min}
                          max={control.max}
                          step={control.step ?? 0.1}
                          value={value}
                          onChange={(event) =>
                            handleRemoteControl(
                              control.id,
                              Number(event.currentTarget.value)
                            )
                          }
                        />
                      </label>
                    );
                  }
                  if (control.type === "select") {
                    const value =
                      control.value ?? control.options[0]?.value ?? "";
                    return (
                      <label
                        key={control.id}
                        className="remote-control remote-select"
                      >
                        <span className="remote-control-label">
                          {control.label}
                        </span>
                        <select
                          value={value}
                          onChange={(event) =>
                            handleRemoteControl(
                              control.id,
                              event.currentTarget.value
                            )
                          }
                        >
                          {control.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  }
                  if (control.type === "toggle") {
                    const value = Boolean(control.value);
                    return (
                      <div
                        key={control.id}
                        className="remote-control remote-toggle"
                      >
                        <span className="remote-control-label">
                          {control.label}
                        </span>
                        <button
                          className={value ? "is-on" : ""}
                          onClick={() =>
                            handleRemoteControl(control.id, !value)
                          }
                        >
                          {value ? "On" : "Off"}
                        </button>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={control.id}
                      className="remote-control remote-button"
                    >
                      <span className="remote-control-label">
                        {control.label}
                      </span>
                      <button
                        onClick={() =>
                          handleRemoteControl(control.id, Date.now())
                        }
                      >
                        Trigger
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : showInputPanel ? (
          <div className="remote-input">
            <div className="remote-app-title">
              <span>Keyboard / Mouse</span>
            </div>
            <button
              className="remote-app-back"
              onClick={() => setRemotePanel("remote")}
            >
              Back to Remote
            </button>
            <div
              className="remote-trackpad"
              ref={padRef}
              onPointerDown={handlePadPointerDown}
              onPointerMove={handlePadPointerMove}
              onPointerUp={handlePadPointerUp}
              onPointerCancel={handlePadPointerCancel}
            >
              <div className="remote-trackpad-label">
                Drag to move · Tap to click
              </div>
            </div>
            <div className="remote-keyboard">
              <input
                ref={keyboardInputRef}
                className="remote-keyboard-input"
                type="text"
                value={keyboardValue}
                onChange={handleKeyboardChange}
                placeholder="Type here to send keys"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
              />
              <div className="remote-keyboard-actions">
                <button onClick={handleKeyboardBackspace}>Backspace</button>
                <button onClick={() => handleKeyboardKey("Enter")}>Enter</button>
                <button onClick={() => handleKeyboardKey("Escape")}>Esc</button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="remote-controls">
              <div className="rocker">
                <button onClick={() => send({ type: "channel", dir: "up" })}>
                  CH UP
                </button>
                <span>CH</span>
                <button onClick={() => send({ type: "channel", dir: "down" })}>
                  CH DOWN
                </button>
              </div>

              <div className="rocker">
                <button onClick={() => send({ type: "volume", dir: "up" })}>
                  VOL UP
                </button>
                <span>VOL</span>
                <button onClick={() => send({ type: "volume", dir: "down" })}>
                  VOL DOWN
                </button>
              </div>
            </div>

            <div className="remote-dpad">
              <button
                className="up"
                onClick={() => send({ type: "nav", dir: "up" })}
              >
                UP
              </button>
              <button
                className="left"
                onClick={() => send({ type: "nav", dir: "left" })}
              >
                LEFT
              </button>
              <button className="ok" onClick={() => send({ type: "select" })}>
                OK
              </button>
              <button
                className="right"
                onClick={() => send({ type: "nav", dir: "right" })}
              >
                RIGHT
              </button>
              <button
                className="down"
                onClick={() => send({ type: "nav", dir: "down" })}
              >
                DOWN
              </button>
            </div>

            <div className="remote-actions">
              <button onClick={() => send({ type: "guide" })}>Guide</button>
              <button onClick={() => send({ type: "info" })}>Info</button>
              <button onClick={() => send({ type: "mute" })}>Mute</button>
            </div>

            {hasSpecialControls ? (
              <div className="remote-specials">
                {hasMicControls ? (
                  <div className="remote-mic">
                    <div className="remote-mic-title">Mic</div>
                    <button
                      className={`remote-mic-toggle ${
                        micEnabled ? "is-on" : ""
                      }`}
                      disabled={micToggleDisabled}
                      onClick={onMicToggle}
                    >
                      {micEnabled ? "Mic On" : "Mic Off"}
                    </button>
                    <div className="remote-mic-status">{micStatusLabel}</div>
                  </div>
                ) : null}
                <div className="remote-special-actions">
                  {hasKeyboardMouse ? (
                    <button
                      className="remote-special-button"
                      onClick={() => setRemotePanel("input")}
                    >
                      Keyboard/Mouse
                    </button>
                  ) : null}
                  {hasAppControls ? (
                    <button
                      className="remote-special-button"
                      onClick={() => setRemotePanel("app")}
                    >
                      App Controls
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="remote-numpad">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button
                  key={num}
                  disabled={showAppPanel || showInputPanel}
                  onClick={() => pushDialDigit(num)}
                >
                  {num}
                </button>
              ))}
              <button
                className="zero"
                disabled={showAppPanel || showInputPanel}
                onClick={() => pushDialDigit(0)}
              >
                0
              </button>
            </div>
          </>
        )}
      </div>
      <DebugPanel show={showDebug} memoryStats={memoryStats} mediaStats={mediaStats} />
      <DialOverlay value={dialOverlay} />
    </div>
  );
}
