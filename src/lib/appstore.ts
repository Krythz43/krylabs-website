// Read side of scripts/sync-appstore.mjs: the committed listing snapshot plus the
// screenshot files it downloaded, resolved to Astro image imports so <Image> can
// resize and serve them like any other asset.
import type { ImageMetadata } from 'astro';
import data from '../data/appstore.json';

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

const listings = data as unknown as Record<string, Listing | string>;

const files = import.meta.glob<ImageMetadata>('/src/assets/appstore/*/*.webp', {
  eager: true,
  import: 'default',
});

export function listing(slug: string): Listing | undefined {
  const l = listings[slug];
  return typeof l === 'object' ? l : undefined;
}

/** Screenshot images for an app, in store order. Empty for apps that are not listed. */
export function screens(slug: string): ImageMetadata[] {
  const l = listing(slug);
  if (!l) return [];
  return l.screenshots
    .map((f) => files[`/src/assets/appstore/${slug}/${f}`])
    .filter((img): img is ImageMetadata => Boolean(img));
}
