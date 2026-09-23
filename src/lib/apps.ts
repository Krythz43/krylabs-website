// Derived facts about an app entry that more than one template needs.
import type { CollectionEntry } from 'astro:content';
import { listing, type Listing } from './appstore';

type App = CollectionEntry<'apps'>;

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
  /** The legal links inside it; the old static BlockBud page used this anchor. */
  privacy: 'privacy',
  /** The site header, from Base.astro. */
  nav: 'nav',
} as const;

/**
 * One id per content section, from the explicit `id` or the slugified heading. Legacy
 * pages under public/ link to some of these, so collisions and reserved names fail the
 * build instead of silently breaking an anchor.
 */
export function sectionIds(app: App): string[] {
  const reserved = new Set<string>(Object.values(PAGE_IDS));
  const ids = app.data.sections.map(
    (s) => s.id ?? s.heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
  );
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id) throw new Error(`${app.id}: a section heading produced an empty id`);
    if (reserved.has(id)) throw new Error(`${app.id}: section id "${id}" is reserved by the page`);
    if (seen.has(id)) throw new Error(`${app.id}: section id "${id}" is used twice`);
    seen.add(id);
  }
  return ids;
}

/**
 * The content entries and the App Store snapshot must agree: every `storeId` needs a
 * snapshot entry under the same slug with the same id, and every snapshot entry needs an
 * app. Anything else means `npm run sync` was not run (or not committed) after a change.
 */
export function checkSnapshot(apps: App[], snapshotSlugs: string[]): void {
  const bySlug = new Map(apps.map((a) => [a.id, a]));
  for (const app of apps) {
    const id = app.data.storeId;
    if (id === undefined) continue;
    const l = listing(app.id);
    if (!l) throw new Error(`${app.id} has storeId ${id} but no snapshot entry: run \`npm run sync\` and commit`);
    if (l.id !== id) throw new Error(`${app.id}: storeId ${id} does not match the snapshot's ${l.id}: run \`npm run sync\``);
  }
  for (const slug of snapshotSlugs) {
    if (!bySlug.has(slug)) throw new Error(`appstore.json has "${slug}" but src/content/apps/${slug}.md does not exist`);
  }
}
