import { THEME_MAP, THEME_ORDER } from "../themes";

export type DisplayTuningPayload = {
  scale?: number | null;
  textScale?: number | null;
  hours?: number | null;
  theme?: string | null;
};

type DisplayTuningPanelProps = {
  uiScale: number;
  textScale?: number;
  visibleHours: number;
  activeThemeId: string;
  onChange: (payload: DisplayTuningPayload) => void;
  className?: string;
  title?: string;
  floating?: boolean;
};

export function DisplayTuningPanel({
  uiScale,
  textScale = 1,
  visibleHours,
  activeThemeId,
  onChange,
  className,
  title = "Display Tuning",
  floating = false,
}: DisplayTuningPanelProps) {
  const themeIds = THEME_ORDER;
  const themeIndex = Math.max(0, themeIds.indexOf(activeThemeId));
  const classes = [
    "display-tuning",
    className,
    floating ? "display-tuning-floating" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <div className="remote-display-title">{title}</div>
      <div className="remote-display-row">
        <span>Scale</span>
        <div className="remote-display-controls">
          <button
            onClick={() =>
              onChange({
                scale: Number((uiScale - 0.05).toFixed(2)),
              })
            }
          >
            -
          </button>
          <div className="remote-display-value">{uiScale.toFixed(2)}x</div>
          <button
            onClick={() =>
              onChange({
                scale: Number((uiScale + 0.05).toFixed(2)),
              })
            }
          >
            +
          </button>
        </div>
      </div>
      <div className="remote-display-row">
        <span>Text</span>
        <div className="remote-display-controls">
          <button
            onClick={() =>
              onChange({
                textScale: Number((textScale - 0.05).toFixed(2)),
              })
            }
          >
            -
          </button>
          <div className="remote-display-value">{textScale.toFixed(2)}x</div>
          <button
            onClick={() =>
              onChange({
                textScale: Number((textScale + 0.05).toFixed(2)),
              })
            }
          >
            +
          </button>
        </div>
      </div>
      <div className="remote-display-row">
        <span>Hours</span>
        <div className="remote-display-controls">
          <button
            onClick={() =>
              onChange({
                hours: Math.max(1, Math.round(visibleHours - 1)),
              })
            }
          >
            -
          </button>
          <div className="remote-display-value">
            {Math.round(visibleHours)}h
          </div>
          <button
            onClick={() =>
              onChange({
                hours: Math.min(6, Math.round(visibleHours + 1)),
              })
            }
          >
            +
          </button>
        </div>
      </div>
      <div className="remote-display-row">
        <span>Theme</span>
        <div className="remote-display-controls">
          <button
            onClick={() =>
              onChange({
                theme:
                  themeIds[(themeIndex - 1 + themeIds.length) % themeIds.length],
              })
            }
          >
            &lt;
          </button>
          <div className="remote-display-value">
            {THEME_MAP[activeThemeId]?.label ?? activeThemeId}
          </div>
          <button
            onClick={() =>
              onChange({
                theme: themeIds[(themeIndex + 1) % themeIds.length],
              })
            }
          >
            &gt;
          </button>
        </div>
      </div>
      <button
        className="remote-display-reset"
        onClick={() =>
          onChange({
            scale: null,
            textScale: null,
            hours: null,
            theme: null,
          })
        }
      >
        Reset Display
      </button>
    </div>
  );
}
