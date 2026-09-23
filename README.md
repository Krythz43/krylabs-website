# krylabs-website

The Krylabs studio site, [krylabs.com](https://krylabs.com). Astro 5, compiled to static HTML,
served by Caddy on the droplet. No client-side framework and one ten-line inline script.

Split out of `MatchMyVibe-Backend` on 2026-08-02. History before that date lives in that repo.

## Commands

```bash
npm install        # install deps
npm run dev        # dev server with HMR → http://localhost:4321
npm run build      # static build → ./dist (also renders the /og/*.png images)
npm run preview    # serve ./dist to sanity-check the build
npm run sync       # refresh App Store data + screenshots (see below), then commit the result
npm start          # zero-dependency production server → http://127.0.0.1:3070
```

## Hosting

**The live site is on the droplet, not the laptop** (topology settled 2026-08-04):

- `krylabs.com` + `www` CNAME to the `leadoven-prod` tunnel → droplet `leadoven-prod-blr1`
  (ssh alias `leadoven`) → Caddy on `:3070` serving `/opt/krylabs-website/dist` (config: this
  repo's `Caddyfile`).
- The Caddy `@api` matcher proxies the legacy apex paths (`/api`, `/auth`, `/health`, `/config`,
  `/eventsweb`, `/events`, `/event-detail`, `/_next`) onward to `api.krylabs.com`. Already-shipped
  app builds call the apex and can't be updated retroactively; new builds call `api.krylabs.com`.
- The laptop still runs `krylabs-website` under PM2 on `127.0.0.1:3070`, but nothing routes
  public traffic to it. Restarting it does **not** deploy.

### Deploy

```bash
git push                                                              # from wherever you edited
ssh leadoven 'cd /opt/krylabs-website && git pull && npm ci && npm run build'
```

`dist/` is gitignored, so the build runs on the droplet. Caddy serves the files directly, no
service restart needed. The build needs no network: fonts, screenshots and store data are all
committed. Every package is a `dependency` (none are dev-only) because all of them are needed
to build, and a `NODE_ENV=production` install must not skip any.

## Where things live

```
src/
├── content/
│   ├── apps/*.md          # one file per app = one page at /<slug> + one row on the home page
│   ├── products/*.md      # web products: a tile on the home page, links out
│   └── posts/*.md         # build notes at /writing/<slug>
├── content.config.ts      # the schemas for the three collections
├── assets/
│   ├── appstore/          # `npm run sync` output: appstore.json + <slug>/*.webp (640px, committed)
│   ├── icons/             # app icons (png/jpg, see below) and svg marks for web products
│   ├── products/          # one screenshot of each web product's live site
│   └── krithick-santhosh.jpg
├── components/            # Strip (phone screenshots), AppRow, AppFacts, ProductTile, Defs, Founder, PostItem, Socials
├── layouts/Base.astro     # <head> meta/OG/JSON-LD, nav, footer, the one script
├── layouts/Legal.astro    # wrapper for /legal/* and the BubbleNest /privacy + /terms pages
├── lib/
│   ├── site.ts            # name, email, address, socials, date helpers
│   ├── appstore.ts        # reads the snapshot + resolves screenshot imports
│   ├── apps.ts            # getApps()/getPosts() (checked + sorted), reserved slugs, links, section ids
│   ├── palette.json       # brand colours for the renderers that cannot read CSS (og.ts, make-logo)
│   ├── jsonld.ts          # Organization / Person / SoftwareApplication / BlogPosting builders
│   └── og.ts              # satori + resvg renderer for /og/*.png
├── pages/
│   ├── index.astro, about.astro, 404.astro
│   ├── [app].astro        # /reelmark, /bubblenest, /blockbud, /cocotree, /oneatatime
│   ├── writing/           # index + [slug]
│   ├── og/[slug].png.ts   # build-time Open Graph images, one per page
│   ├── bubblenest/download.astro   # store splitter (standalone, no layout on purpose)
│   ├── privacy.astro, terms.astro  # BubbleNest app legal pages (store-listing URLs)
│   └── legal/             # company legal: terms, privacy, refunds, shipping, pricing, contact
└── styles/global.css      # the whole design system
scripts/sync-appstore.mjs  # pulls listing data + screenshots from the iTunes lookup API
scripts/make-logo.mjs      # renders public/logo.png (the Organization logo in JSON-LD)
public/                    # copied verbatim into dist/ (see below)
server.js                  # zero-dependency static server (fallback; Caddy is the origin)
```

### Adding or changing an app

1. Edit or add `src/content/apps/<slug>.md`. The slug is the URL.
2. If it is on the App Store, put its track id in the entry as `storeId:`, run `npm run sync`,
   and commit `src/assets/appstore/`. The build fails if an entry's `storeId` has no matching
   snapshot (or the other way round), so a forgotten sync cannot ship.
3. Put the icon under `src/assets/icons/` as a **PNG or JPEG** and reference it from the entry's
   `icon:` field; the page, the home row and the OG image all use that one import. It cannot be an
   SVG: the content layer turns SVGs into components with no file path, and the OG renderer
   needs the file. (Web product icons are not used in OG images, so those can stay SVG.)

Store facts on the site (version, updated date, price, minimum OS, screenshots) all come from
the snapshot, so a new release is `npm run sync` + commit + deploy.

Each `sections:` entry becomes a section with an anchor id, the slugified heading unless the entry
sets `id:`. The entries set the ids the previous pages exposed (`#features`, `#how-it-works`,
`#how`), so old links keep working; the legal block is `#legal` with a `#privacy` anchor. The build
fails on duplicate or reserved ids, and on an app slug that would collide with an existing page,
a public file, an apex path the Caddyfile proxies to the API, or a home-page section id.

### `public/` — not just assets

`public/` holds pages carried over from the pre-Astro site that are **referenced by app store /
Play Console listings and must not move**. They are plain HTML kept at directory paths so their
URLs are byte-identical to before:

| URL | File |
| --- | --- |
| `/contact` | BubbleNest contact page (`public/contact/index.html`) |
| `/bubblenest/delete-account` | Google Play *Data safety* requirement |
| `/bubblenest/child-safety` | Google Play *child safety standards* requirement |
| `/reelmark/tos`, `/reelmark/privacypolicy` | App Store listing |
| `/blockbud/privacy.html`, `/blockbud/terms.html` | BlockBud legal (the index is now an Astro page) |
| `/oneatatime/privacy.html`, `/oneatatime/terms.html`, `/oneatatime/support.html` | One legal + support |
| `/static/css/style.css`, `/static/js/app.js` | the stylesheet those pages load |

## Design system

- **Palette:** warm paper (`--bg`), one accent (terracotta), hairlines for structure. Tokens at
  `:root` in `src/styles/global.css`.
- **Type:** Instrument Serif for display headings, Inter for everything else. Both self-hosted
  from `@fontsource` (latin subsets only); the two first-paint faces are preloaded. The OG
  renderer and the logo script use the same package's WOFF files, so there is one copy of each
  face in the repo.
- **Imagery:** real App Store screenshots are the only decoration. The hero strip is one
  screenshot from each featured app, then a second from each.
- **Motion:** one entrance animation (the hero strip rises on load) and cross-document view
  transitions in CSS. Nothing on scroll, nothing on hover beyond a border. `prefers-reduced-motion`
  turns the entrance off.

## Note on this being a public repo

There are no secrets here and none should ever be added. The Google client ID in
`public/bubblenest/delete-account/index.html` is an OAuth **Web client ID**, which is public by
design; the matching client *secret* lives only in the backend's environment.
