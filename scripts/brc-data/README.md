# BRC survey data (local only, not committed)

`layout.json` here is Burning Man's own published city survey for the year,
fetched via the `fetch-data`/`fetch-api` scripts in the `dustcompass`
project (github.com/lnorton89/dustcompass) and copied in locally. It's
gitignored here the same way dustcompass itself gitignores `public/data` —
it's not ours to redistribute.

To regenerate:

```bash
cd path/to/dustcompass
node scripts/fetch-data.mjs 2026          # city geometry, no API key needed
npm run fetch-api -- 2026                 # camp/art listings, needs BURNING_MAN_API_KEY in .env
cp public/data/2026/layout.json <this-repo>/scripts/brc-data/2026/layout.json
cp public/data/2026/art.json    <this-repo>/scripts/brc-data/2026/art.json      # if present
cp public/data/2026/camp.json   <this-repo>/scripts/brc-data/2026/camp.json     # if present
```

Then run `npm run geocode-photos` in this repo, which reads those files plus
GPS EXIF from `media/` and writes a `location` string onto each item in
`src/manifest.json` — only that short derived text is committed, not the
survey data itself.
