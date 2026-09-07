import { useEffect, useRef } from "react";
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

  return (
    <div className="lightbox-backdrop" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose} aria-label="Close">
        &times;
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
      </div>
    </div>
  );
}
