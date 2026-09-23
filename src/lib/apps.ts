// Derived facts about an app entry that more than one template needs.
import type { CollectionEntry } from 'astro:content';
import type { Listing } from './appstore';

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

// Ids the app page uses for its own fixed parts; a section may not take them.
const RESERVED = new Set(['download', 'support', 'nav']);

/**
 * One id per content section, from the explicit `id` or the slugified heading. Legacy
 * pages under public/ link to some of these, so collisions and reserved names fail the
 * build instead of silently breaking an anchor.
 */
export function sectionIds(app: App): string[] {
  const ids = app.data.sections.map(
    (s) => s.id ?? s.heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
  );
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id) throw new Error(`${app.id}: a section heading produced an empty id`);
    if (RESERVED.has(id)) throw new Error(`${app.id}: section id "${id}" is reserved by the page`);
    if (seen.has(id)) throw new Error(`${app.id}: section id "${id}" is used twice`);
    seen.add(id);
  }
  return ids;
}
