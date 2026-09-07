# Burning Man 2026

A photo/video gallery built with Vite + React + TypeScript, deployed for free on GitHub Pages.

## Development

```bash
npm install
npm run process-media   # regenerate public/media/ + src/manifest.json from media/
npm run dev
```

## Deploy

Push to `main` — the `deploy.yml` GitHub Actions workflow builds the site and publishes it to GitHub Pages automatically.

Raw source photos/videos live in `media/` (gitignored, not published). `npm run process-media` resizes/compresses them into `public/media/`, which is what actually ships.
