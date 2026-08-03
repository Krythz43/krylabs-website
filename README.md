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

The site runs under PM2 as `krylabs-website`, listening on `127.0.0.1:3070`, fronted by the
`bntunnel` cloudflared tunnel.

> ⚠️ **The origin is currently a laptop, not a server.** `bntunnel` runs on the ASUS TUF F15
> (`magnolia`) and dials *out* to Cloudflare — so krylabs.com is only reachable while that machine
> is awake. Powering it off **or just closing the lid** (logind defaults to suspend) takes the site
> down until it resumes. There is no copy of the site anywhere else. Moving this repo to a real
> always-on host is a `git clone && npm ci && npm run build && pm2 start server.js` plus an ingress
> rule; the split was done partly to make that a small change.

`krylabs.com` is **split across two origins**. Cloudflare tunnel ingress matches top-down, so a
narrow API rule sits above the catch-all:

| Path | Origin |
| --- | --- |
| `/api`, `/auth`, `/health`, `/config`, `/eventsweb` | `:8080` — MatchMyVibe-Backend (Go API) |
| `/events`, `/event-detail`, `/_next` | `:8080` — BubbleNest events app |
| everything else | `:3070` — **this repo** |

The rules live in `~/.cloudflared/config.yml` on the tunnel host. After editing them, check the routing
with `cloudflared tunnel ingress validate` and `cloudflared tunnel ingress rule <url>`.

### Deploy

```bash
cd ~/krylabs-website
git pull && npm ci && npm run build && pm2 restart krylabs-website
```

`dist/` is gitignored, so the build must run on the box before the restart.

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
