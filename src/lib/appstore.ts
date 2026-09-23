// Read side of scripts/sync-appstore.mjs: the committed listing snapshot plus the
// screenshot files it downloaded, resolved to Astro image imports so <Image> can
// resize and serve them like any other asset.
import type { ImageMetadata } from 'astro';
import snapshot from '../data/appstore.json';

export interface Listing {
  id: number;
  name: string;
  bundleId: string;
  version: string;
  released: string;
  updated: string;
  minimumOs: string;
  price: number;
  currency: string;
  formattedPrice: string;
  genres: string[];
  storeUrl: string;
  screenshots: string[];
}

const apps: Record<string, Listing> = snapshot.apps;

const files = import.meta.glob<ImageMetadata>('/src/assets/appstore/*/*.webp', {
  eager: true,
  import: 'default',
});

export function listing(slug: string): Listing | undefined {
  return apps[slug];
}

/**
 * Screenshot images for an app, in store order. Empty for apps that are not listed.
 * A file the snapshot names but the repo lacks is a broken sync, so it fails the build
 * rather than quietly shipping fewer screenshots.
 */
export function screens(slug: string): ImageMetadata[] {
  const l = listing(slug);
  if (!l) return [];
  return l.screenshots.map((f) => {
    const img = files[`/src/assets/appstore/${slug}/${f}`];
    if (!img) {
      throw new Error(
        `appstore.json lists ${slug}/${f} but src/assets/appstore/${slug}/${f} is missing. ` +
          'Run `npm run sync` and commit both the JSON and the screenshot directory.',
      );
    }
    return img;
  });
}
