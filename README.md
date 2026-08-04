# krylabs-website

The Krylabs studio site — [krylabs.com](https://krylabs.com). Astro 5 + GSAP + Lenis, compiled
to static HTML and served by a zero-dependency Node server.

Split out of `MatchMyVibe-Backend` on 2026-08-02. History before that date lives in that repo.

## Commands

```bash
npm install        # install deps
npm run dev        # dev server with HMR → http://localhost:4321
npm run build      # static build → ./dist
npm run preview    # serve ./dist to sanity-check the build
npm start          # production server → http://127.0.0.1:3070
```

## Hosting

**The live site is on the droplet, not the laptop** (topology settled 2026-08-04):

- `krylabs.com` + `www` CNAME to the `leadoven-prod` tunnel → droplet `leadoven-prod-blr1`
  (ssh alias `leadoven`) → Caddy on `:3070` serving `/opt/krylabs-website/dist` (config: this
  repo's `Caddyfile`).
- The Caddy `@api` matcher proxies the legacy apex paths (`/api`, `/auth`, `/health`, `/config`,
  `/eventsweb`, `/events`, `/event-detail`, `/_next`) onward to `api.krylabs.com`, which routes
  through `bntunnel` to the Go API on the laptop (`magnolia`). Already-shipped app builds call the
  apex and can't be updated retroactively; new builds call `api.krylabs.com` directly.
- The laptop still runs `krylabs-website` under PM2 on `127.0.0.1:3070`, but nothing routes
  public traffic to it — it is a warm spare, not the origin. Restarting it does **not** deploy.

### Deploy

```bash
git push                                                   # from wherever you edited
ssh leadoven 'cd /opt/krylabs-website && git pull && npm run build'
```

`dist/` is gitignored, so the build must run on the droplet. Caddy serves the files directly —
no service restart needed. Add `npm ci` before the build if dependencies changed.

## Structure

```
src/
├── components/         # Card, Feature, SectionHead, PageHero, Tag — reusable, uniform
│                       #   Card: optional `badge` prop = accent pill (ReelMark uses "Check this out!")
├── layouts/
│   ├── Base.astro      # shared shell: <head> meta/SEO, nav, footer, motion script
│   └── Legal.astro     # wrapper for /legal/* prose pages
├── pages/
│   ├── index.astro     # home (hero, work grid, founder, contact)
│   ├── about.astro
│   ├── bubblenest.astro, reelmark.astro
│   ├── privacy.astro, terms.astro   # BubbleNest app legal pages (store-listing URLs)
│   ├── 404.astro
│   └── legal/          # company legal: terms, privacy, refunds, shipping, pricing, contact
└── styles/global.css
public/                 # copied verbatim into dist/ (see below)
server.js               # production static server
```

### `public/` — not just assets

Alongside `assets/`, `favicon.ico` and `robots.txt`, `public/` holds pages carried over from the
pre-Astro site that are **referenced by app store / Play Console listings and must not move**.
They are plain HTML kept at directory paths so their URLs are byte-identical to before:

| URL | File |
| --- | --- |
| `/contact` | `public/contact/index.html` |
| `/bubblenest/delete-account` | Google Play *Data safety* requirement |
| `/bubblenest/child-safety` | Google Play *child safety standards* requirement |
| `/reelmark/tos`, `/reelmark/privacypolicy` | App Store listing |
| `/blockbud/*`, `/oneatatime/*` | mirrored app sites (relative links, self-contained) |
| `/static/css/style.css`, `/static/js/app.js` | the stylesheet those pages load |

Editing an Astro page will not touch these — they are hand-written HTML on the old stylesheet.

## Design system

- **Aesthetic:** minimal, warm-monochrome ("Astral" / family.co), generous whitespace.
- **Type:** Inter (UI) + Instrument Serif (italic accents) + JetBrains Mono (micro-labels).
- **Motion (toned down):** gentle Lenis smooth-scroll + subtle GSAP fade-up reveals, plus Astro
  view transitions (`<ClientRouter />`). All gated behind `prefers-reduced-motion`.
- The entire design system lives in **`src/styles/global.css`** (CSS variables at `:root`).

## Note on this being a public repo

There are no secrets here and none should ever be added — the whole repo compiles to files that
are served publicly anyway. The Google client ID in `public/bubblenest/delete-account/index.html`
is an OAuth **Web client ID**, which is public by design; the matching client *secret* lives only
in the backend's environment and must never appear in this repo.
