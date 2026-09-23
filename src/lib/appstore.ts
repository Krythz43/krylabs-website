// Read side of scripts/sync-appstore.mjs: the committed listing snapshot plus the
// screenshot files it downloaded, resolved to Astro image imports so <Image> can
// resize and serve them like any other asset.
import type { ImageMetadata } from 'astro';
import snapshot from '../assets/appstore/appstore.json';

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

/** Every slug the snapshot knows, for the consistency check in getApps() (src/lib/apps.ts). */
export const snapshotSlugs: string[] = Object.keys(apps);

const files = import.meta.glob<ImageMetadata>('/src/assets/appstore/*/*.webp', {
  eager: true,
  import: 'default',
});

// The same files as base64 data URIs, for the OG renderer, which needs the bytes rather
// than a URL and must not depend on an on-disk path (see screenBytes).
const inlined = import.meta.glob<string>('/src/assets/appstore/*/*.webp', {
  query: '?inline',
  import: 'default',
  eager: true,
});

export function listing(slug: string): Listing | undefined {
  return apps[slug];
}

function keyFor(slug: string, file: string): string {
  return `/src/assets/appstore/${slug}/${file}`;
}

function missing(slug: string, file: string): Error {
  return new Error(
    `appstore.json lists ${slug}/${file} but src/assets/appstore/${slug}/${file} is missing. ` +
      'Run `npm run sync` and commit src/assets/appstore/.',
  );
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
    const img = files[keyFor(slug, f)];
    if (!img) throw missing(slug, f);
    return img;
  });
}

/** The first `n` screenshots as raw WebP bytes, for build-time rendering. */
export function screenBytes(slug: string, n: number): Buffer[] {
  const l = listing(slug);
  if (!l) return [];
  return l.screenshots.slice(0, n).map((f) => {
    const uri = inlined[keyFor(slug, f)];
    if (!uri) throw missing(slug, f);
    return Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
  });
}
