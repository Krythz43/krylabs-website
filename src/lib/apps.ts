// The collections, checked and sorted, plus the derived facts more than one template needs.
import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import type { ImageMetadata } from 'astro';
import caddyfile from '../../Caddyfile?raw';
import { listing, screens, snapshotSlugs, type Listing } from './appstore';

export type App = CollectionEntry<'apps'>;
export type Post = CollectionEntry<'posts'>;

/** Ids of the home page's sections, used for its `id` attributes and the nav's anchors. */
export const HOME_IDS = {
  apps: 'apps',
  web: 'web',
  founder: 'founder',
  writing: 'writing',
  contact: 'contact',
} as const;

// Paths an app slug would collide with, each read from where it is defined:
//   - a static page at the slug: src/pages/<slug>.astro or <slug>/index.astro (keys only,
//     nothing is imported). A directory that only holds sub-pages, like
//     src/pages/bubblenest/download.astro, is fine: the app page becomes its index.
//   - a public/ directory with its own index.html, e.g. public/contact/.
//   - the apex paths the Caddyfile's @api matcher proxies to the API: those never reach
//     the static files, whatever the build emits.
//   - the home page's section ids and the header's id.
//   - the fixed slugs of the OG endpoint (src/pages/og/[slug].png.ts), which shares one
//     namespace with app cards; post cards are `writing-<slug>`.
const PAGES = Object.keys(import.meta.glob('/src/pages/**/*.{astro,ts}'))
  .map((p) => p.replace(/^\/src\/pages\//, ''))
  .filter((p) => !p.includes('/') || p.endsWith('/index.astro'))
  .map((p) => p.split('/')[0].replace(/\.[^.]+$/, ''));
const PUBLIC = Object.keys(import.meta.glob('/public/*/index.html', { query: '?raw' })).map(
  (p) => p.replace(/^\/public\//, '').split('/')[0],
);
const PROXIED = (caddyfile.match(/^\s*@api path (.+)$/m)?.[1] ?? '')
  .split(/\s+/)
  .map((p) => p.replace(/^\//, '').replace(/\/\*$/, ''))
  .filter(Boolean);
const OG_FIXED = ['home', 'about', 'writing'];
const RESERVED_SLUGS = new Set([...PAGES, ...PUBLIC, ...PROXIED, ...Object.values(HOME_IDS), 'nav', ...OG_FIXED]);

let cachedApps: Promise<App[]> | undefined;

/**
 * Every app, in display order, after checking that the content entries and the App Store
 * snapshot agree: each `storeId` has a snapshot entry under the same slug with the same
 * id, each snapshot entry has an app that still declares that id, and no slug collides
 * with an existing path. Anything else means `npm run sync` was not run (or committed)
 * after a change, and the build stops here instead of shipping stale or missing store
 * facts. Loaded and checked once per build, however many routes ask.
 */
export function getApps(): Promise<App[]> {
  cachedApps ??= (async () => {
    const apps = (await getCollection('apps')).sort((a, b) => a.data.order - b.data.order);
    const bySlug = new Map(apps.map((a) => [a.id, a]));
    for (const app of apps) {
      if (RESERVED_SLUGS.has(app.id) || app.id.startsWith('writing-')) {
        throw new Error(`src/content/apps/${app.id}.md: "${app.id}" is already a path on the site`);
      }
      const id = app.data.storeId;
      if (id === undefined) continue;
      const l = listing(app.id);
      if (!l) throw new Error(`${app.id} has storeId ${id} but no snapshot entry: run \`npm run sync\` and commit`);
      if (l.id !== id) throw new Error(`${app.id}: storeId ${id} does not match the snapshot's ${l.id}: run \`npm run sync\``);
    }
    for (const slug of snapshotSlugs) {
      const app = bySlug.get(slug);
      if (!app) throw new Error(`appstore.json has "${slug}" but src/content/apps/${slug}.md does not exist: run \`npm run sync\``);
      if (app.data.storeId === undefined) throw new Error(`appstore.json has "${slug}" but its entry no longer declares a storeId: run \`npm run sync\``);
    }
    return apps;
  })();
  return cachedApps;
}

let cachedPosts: Promise<Post[]> | undefined;

/** Every build note, newest first. */
export function getPosts(): Promise<Post[]> {
  cachedPosts ??= getCollection('posts').then((posts) =>
    posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime()),
  );
  return cachedPosts;
}

/**
 * The app's store listing, if it has shipped. An app still in development keeps its
 * listing out of the rows, the facts, the buttons and the counts alike, so every place
 * that says "on the App Store" means the same thing.
 */
export function listingFor(app: App): Listing | undefined {
  return app.data.status === 'live' ? listing(app.id) : undefined;
}

/** On the App Store: shipped, with a listing. */
export function onAppStore(app: App): boolean {
  return listingFor(app) !== undefined;
}

/** On Google Play: shipped, with an Android build. */
export function onGooglePlay(app: App): boolean {
  return app.data.status === 'live' && app.data.platforms.includes('Android');
}

export interface Shot {
  img: ImageMetadata;
  alt: string;
}

/** The first `n` store screenshots with their alt text, for a Strip. */
export function shotsFor(app: App, n = Infinity): Shot[] {
  if (!listingFor(app)) return [];
  return screens(app.id)
    .slice(0, n)
    .map((img, i) => ({ img, alt: `${app.data.name} screenshot ${i + 1}` }));
}

export interface Link {
  label: string;
  href: string;
  external: boolean;
}

/**
 * Where the app's main button goes: its own store splitter when it has one, else the
 * App Store listing. `long` picks the full button label over the short list label.
 */
export function primaryLink(app: App, long = false): Link | null {
  const d = app.data;
  const store = listingFor(app);
  if (d.download) return { ...d.download, external: d.download.href.startsWith('http') };
  if (store) return { label: long ? 'Download on the App Store' : 'App Store', href: store.storeUrl, external: true };
  return null;
}

/** Ids the app page gives its own fixed parts. Content sections may not take them. */
export const PAGE_IDS = {
  /** The actions row under the hero. */
  download: 'download',
  /** The support section at the end. */
  support: 'support',
  /** The legal links inside it (the old BubbleNest page's anchor). */
  legal: 'legal',
  /** An anchor at the top of the legal links (the old BlockBud page's anchor). */
  privacy: 'privacy',
  /** The site header, from Base.astro. */
  nav: 'nav',
} as const;

/** "What's inside" → "whats-inside". Apostrophes vanish; other punctuation becomes a hyphen. */
export function slugify(text: string): string {
  return text.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/**
 * One id per content section, from the explicit `id` or the slugified heading. Pages
 * outside the site link to some of these, so collisions and reserved names fail the
 * build instead of silently breaking an anchor.
 */
export function sectionIds(app: App): string[] {
  const reserved = new Set<string>(Object.values(PAGE_IDS));
  const ids = app.data.sections.map((s) => s.id ?? slugify(s.heading));
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id) throw new Error(`${app.id}: a section heading produced an empty id`);
    if (reserved.has(id)) throw new Error(`${app.id}: section id "${id}" is reserved by the page`);
    if (seen.has(id)) throw new Error(`${app.id}: section id "${id}" is used twice`);
    seen.add(id);
  }
  return ids;
}
