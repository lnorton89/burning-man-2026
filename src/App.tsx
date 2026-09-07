import { useMemo, useState } from "react";
import manifest from "./manifest.json";
import type { MediaItem } from "./types";
import Lightbox from "./Lightbox";

const items = manifest as unknown as MediaItem[];

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function dayKey(date: string | null): string {
  return date ? date.slice(0, 10) : "unknown";
}

function formatDayHeading(key: string): string {
  if (key === "unknown") return "Undated";
  const d = new Date(`${key}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export default function App() {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, MediaItem[]>();
    for (const item of items) {
      const key = dayKey(item.date);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, []);

  const photoCount = items.filter((i) => i.type === "photo").length;
  const videoCount = items.filter((i) => i.type === "video").length;

  return (
    <div className="page">
      <header className="hero">
        <h1>Burning Man 2026</h1>
        <p className="subtitle">
          {photoCount} photos &middot; {videoCount} videos from the playa
        </p>
      </header>

      {groups.map(([key, dayItems]) => (
        <section key={key} className="day-section">
          <h2 className="day-heading">{formatDayHeading(key)}</h2>
          <div className="grid">
            {dayItems.map((item) => {
              const globalIndex = items.indexOf(item);
              return (
                <button
                  key={item.id}
                  className="tile"
                  style={{ aspectRatio: `${item.width} / ${item.height}` }}
                  onClick={() => setLightboxIndex(globalIndex)}
                >
                  <img
                    src={import.meta.env.BASE_URL + (item.type === "photo" ? item.thumb : item.poster)}
                    alt=""
                    loading="lazy"
                  />
                  {item.type === "video" && (
                    <span className="video-badge">
                      <svg viewBox="0 0 24 24" className="play-icon" aria-hidden="true">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      {formatDuration(item.duration)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {lightboxIndex !== null && (
        <Lightbox
          items={items}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}

      <footer className="footer">
        <p>Built with Vite + React + TypeScript.</p>
      </footer>
    </div>
  );
}
