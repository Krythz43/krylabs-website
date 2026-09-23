// The app collection, checked and sorted, plus the derived facts more than one template needs.
import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import type { ImageMetadata } from 'astro';
import { listing, screens, snapshotSlugs, type Listing } from './appstore';

export type App = CollectionEntry<'apps'>;

// Top-level paths that already exist as pages, directories or files; an app cannot take them.
const RESERVED_SLUGS = new Set([
  'about', 'writing', 'privacy', 'terms', 'legal', 'contact', 'og', 'home', '404',
  'static', 'assets', 'favicon.ico', 'logo.png', 'robots.txt', 'sitemap-index.xml',
]);

/**
 * Every app, in display order, after checking that the content entries and the App Store
 * snapshot agree: each `storeId` has a snapshot entry under the same slug with the same
 * id, each snapshot entry has an app that still declares that id, and no slug shadows an
 * existing route. Anything else means `npm run sync` was not run (or committed) after a
 * change, and the build stops here instead of shipping stale or missing store facts.
 */
export async function getApps(): Promise<App[]> {
  const apps = (await getCollection('apps')).sort((a, b) => a.data.order - b.data.order);
  const bySlug = new Map(apps.map((a) => [a.id, a]));
  for (const app of apps) {
    if (RESERVED_SLUGS.has(app.id)) throw new Error(`src/content/apps/${app.id}.md: "${app.id}" is already a route on the site`);
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
}

/** Live on the App Store: has a listing and is not still in development. */
export function onAppStore(app: App): boolean {
  return app.data.status === 'live' && listing(app.id) !== undefined;
}

/** Live on Google Play: an Android build of an app that has shipped. */
export function onGooglePlay(app: App): boolean {
  return app.data.status === 'live' && app.data.platforms.includes('Android');
}

export interface Shot {
  img: ImageMetadata;
  alt: string;
}

/** The first `n` store screenshots with their alt text, for a Strip. */
export function shotsFor(app: App, n = Infinity): Shot[] {
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
export function primaryLink(app: App, store: Listing | undefined, long = false): Link | null {
  const d = app.data;
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
