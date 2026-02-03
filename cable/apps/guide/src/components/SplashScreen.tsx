import type { CSSProperties } from "react";

type SplashScreenProps = {
  active: boolean;
};

export function SplashScreen({ active }: SplashScreenProps) {
  return (
    <div className={`splash-screen ${active ? "is-active" : ""}`} aria-hidden={!active}>
      <div className="splash-scanlines" aria-hidden="true" />
      <div className="splash-inner">
        <div className="splash-mandala" aria-hidden="true">
          {Array.from({ length: 12 }, (_, idx) => (
            <span
              key={idx}
              className="splash-petal"
              style={{ "--i": idx } as CSSProperties}
            />
          ))}
          <div className="splash-burst" aria-hidden="true">
            {Array.from({ length: 12 }, (_, idx) => (
              <span
                key={`burst-${idx}`}
                className="splash-burst-dot"
                style={{ "--i": idx } as CSSProperties}
              />
            ))}
          </div>
          <div className="splash-ring" />
          <div className="splash-core" />
        </div>
        <div className="splash-text">
          <div className="splash-title">Chiba Cable Television</div>
          <div className="splash-subtitle">Signal Sync</div>
          <div className="splash-tag">Initializing</div>
        </div>
      </div>
    </div>
  );
}
