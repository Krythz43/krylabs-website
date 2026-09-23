// Build-time Open Graph images: /og/home.png, /og/about.png, /og/writing.png,
// /og/<app>.png and /og/writing-<post>.png. Pages reference them via Base's ogImage prop.
// Screenshots arrive as inlined bytes and icons by the path the content layer declares,
// so nothing here guesses at the filesystem.
import type { APIRoute } from 'astro';
import { renderOg, type OgSpec } from '../../lib/og';
import { screenBytes } from '../../lib/appstore';
import { getApps, getPosts, listingFor } from '../../lib/apps';
import { site, credentials } from '../../lib/site';

export async function getStaticPaths() {
  const apps = await getApps();
  const posts = await getPosts();

  // The apps the home hero leads with, one screenshot each; the card fits three.
  const featured = apps.filter((a) => a.data.featured && listingFor(a)).slice(0, 3);

  const pages: { slug: string; spec: OgSpec }[] = [
    {
      slug: 'home',
      spec: {
        kicker: `${site.name}, an independent app studio in Bengaluru`,
        title: site.tagline,
        description: 'iPhone apps and web products, designed, built and shipped by one person.',
        screenshots: featured.flatMap((a) => screenBytes(a.id, 1)),
      },
    },
    {
      slug: 'about',
      spec: {
        kicker: `About ${site.name}`,
        title: 'An independent studio that ships.',
        description: `Founded by ${site.founder.name}. ${credentials}`,
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
        screenshots: listingFor(app) ? screenBytes(app.id, 3) : [],
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
