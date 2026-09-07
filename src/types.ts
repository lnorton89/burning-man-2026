export interface PhotoItem {
  id: string;
  type: "photo";
  date: string | null;
  thumb: string;
  full: string;
  width: number;
  height: number;
}

export interface VideoItem {
  id: string;
  type: "video";
  date: string | null;
  poster: string;
  video: string;
  width: number;
  height: number;
  duration: number;
}

export type MediaItem = PhotoItem | VideoItem;
