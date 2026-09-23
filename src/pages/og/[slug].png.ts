// Build-time Open Graph images: /og/home.png, /og/about.png, /og/writing.png,
// /og/<app>.png and /og/writing-<post>.png. Pages reference them via Base's ogImage prop.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import fs from 'node:fs';
import path from 'node:path';
import { renderOg, type OgSpec } from '../../lib/og';
import { listing } from '../../lib/appstore';
import { site } from '../../lib/site';

const ICONS = path.join(process.cwd(), 'src/assets/icons');
const SHOTS = path.join(process.cwd(), 'src/assets/appstore');

// Icons are named after the app slug, whatever their extension.
function iconFor(slug: string): string | undefined {
  const file = fs.readdirSync(ICONS).find((f) => f.startsWith(`${slug}.`));
  return file ? path.join(ICONS, file) : undefined;
}

export async function getStaticPaths() {
  const apps = await getCollection('apps');
  const posts = await getCollection('posts');

  const pages: { slug: string; spec: OgSpec }[] = [
    {
      slug: 'home',
      spec: {
        kicker: `${site.name}, an independent app studio in Bengaluru`,
        title: site.tagline,
        description: 'iPhone apps and web products, designed, built and shipped by one person.',
        screenshotPaths: ['reelmark/01.webp', 'bubblenest/01.webp', 'blockbud/01.webp'].map((p) => path.join(SHOTS, p)),
      },
    },
    {
      slug: 'about',
      spec: {
        kicker: `About ${site.name}`,
        title: 'An independent studio that ships.',
        description: `Founded by ${site.founder.name}. Previously at PhonePe and Blinkit. IIT Kharagpur.`,
      },
    },
    {
      slug: 'writing',
      spec: {
        kicker: `${site.name} build notes`,
        title: 'What shipped, what broke, what it took.',
      },
    },
    ...apps.map((app) => {
      const store = listing(app.id);
      return {
        slug: app.id,
        spec: {
          kicker: `${app.data.name}, ${app.data.tagline.toLowerCase()}`,
          title: app.data.hero.title,
          description: app.data.summary,
          iconPath: iconFor(app.id),
          screenshotPaths: (store?.screenshots ?? []).slice(0, 3).map((f) => path.join(SHOTS, app.id, f)),
        },
      };
    }),
    ...posts.map((post) => ({
      slug: `writing-${post.id}`,
      spec: {
        kicker: `Build notes, ${site.name}`,
        title: post.data.title,
        description: post.data.description,
      },
    })),
  ];

  return pages.map((p) => ({ params: { slug: p.slug }, props: { spec: p.spec } }));
}

export const GET: APIRoute = async ({ props }) => {
  const png = await renderOg((props as { spec: OgSpec }).spec);
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
