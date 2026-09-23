// Build-time Open Graph images: /og/home.png, /og/about.png, /og/writing.png,
// /og/<app>.png and /og/writing-<post>.png. Pages reference them via Base's ogImage prop.
// Icons and screenshots come from the same image imports the pages use, so the files
// are resolved by Astro rather than by guessing paths.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { renderOg, type OgSpec } from '../../lib/og';
import { screens } from '../../lib/appstore';
import { site } from '../../lib/site';

export async function getStaticPaths() {
  const apps = (await getCollection('apps')).sort((a, b) => a.data.order - b.data.order);
  const posts = await getCollection('posts');
  const paths = (slug: string, n: number) => screens(slug).slice(0, n).map((img) => img.fsPath);

  // The same apps the home hero leads with, one screenshot each.
  const featured = apps.filter((a) => a.data.featured).slice(0, 3);

  const pages: { slug: string; spec: OgSpec }[] = [
    {
      slug: 'home',
      spec: {
        kicker: `${site.name}, an independent app studio in Bengaluru`,
        title: site.tagline,
        description: 'iPhone apps and web products, designed, built and shipped by one person.',
        screenshotPaths: featured.flatMap((a) => paths(a.id, 1)),
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
    ...apps.map((app) => ({
      slug: app.id,
      spec: {
        kicker: `${app.data.name}, ${app.data.tagline}`,
        title: app.data.hero.title,
        description: app.data.summary,
        iconPath: app.data.icon.fsPath,
        screenshotPaths: paths(app.id, 3),
      },
    })),
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
