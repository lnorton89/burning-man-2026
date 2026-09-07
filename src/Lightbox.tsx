import { useEffect, useRef, useState } from "react";
import type { MediaItem } from "./types";

interface LightboxProps {
  items: MediaItem[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export default function Lightbox({ items, index, onClose, onNavigate }: LightboxProps) {
  const item = items[index];
  const videoRef = useRef<HTMLVideoElement>(null);
  const [copied, setCopied] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setCopied(false);
  }, [item]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable (e.g. insecure context) - nothing more we can do
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onNavigate((index - 1 + items.length) % items.length);
      else if (e.key === "ArrowRight") onNavigate((index + 1) % items.length);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, items.length, onClose, onNavigate]);

  useEffect(() => {
    videoRef.current?.load();
  }, [item]);

  if (!item) return null;

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }

  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Require a mostly-horizontal swipe, well past accidental finger
    // wobble, so a vertical scroll attempt never gets read as a nav swipe.
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) onNavigate((index + 1) % items.length);
    else onNavigate((index - 1 + items.length) % items.length);
  }

  return (
    <div
      className="lightbox-backdrop"
      onClick={onClose}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      role="dialog"
      aria-modal="true"
      aria-label={`${item.type === "video" ? "Video" : "Photo"} ${index + 1} of ${items.length}`}
    >
      <button className="lightbox-close" onClick={onClose} aria-label="Close">
        &times;
      </button>
      <button
        className="lightbox-copy"
        onClick={(e) => {
          e.stopPropagation();
          copyLink();
        }}
      >
        {copied ? "Copied!" : "Copy link"}
      </button>
      <button
        className="lightbox-nav lightbox-prev"
        aria-label="Previous"
        onClick={(e) => {
          e.stopPropagation();
          onNavigate((index - 1 + items.length) % items.length);
        }}
      >
        &#8249;
      </button>
      <button
        className="lightbox-nav lightbox-next"
        aria-label="Next"
        onClick={(e) => {
          e.stopPropagation();
          onNavigate((index + 1) % items.length);
        }}
      >
        &#8250;
      </button>

      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        {item.type === "photo" ? (
          <img src={import.meta.env.BASE_URL + item.full} alt="" />
        ) : (
          <video ref={videoRef} controls autoPlay playsInline>
            <source src={import.meta.env.BASE_URL + item.video} type="video/mp4" />
          </video>
        )}
      </div>

      <div className="lightbox-counter">
        {index + 1} / {items.length}
        {item.location && <span className="lightbox-location"> &middot; {item.location}</span>}
      </div>
    </div>
  );
}
