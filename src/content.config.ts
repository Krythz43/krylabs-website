import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// One entry per app. The file name is the URL: apps/reelmark.md → /reelmark. Store facts
// (version, price, screenshots) are NOT here; they come from src/data/appstore.json via
// `npm run sync`, keyed by the same slug.
const apps = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/apps' }),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      tagline: z.string(),
      summary: z.string(),
      icon: image(),
      platforms: z.array(z.string()),
      status: z.enum(['live', 'in-development']).default('live'),
      order: z.number(),
      featured: z.boolean().default(false),
      // Where the primary button goes. Cross-platform apps point at their own store
      // splitter; single-store apps use the listing URL from appstore.json.
      download: z.object({ label: z.string(), href: z.string() }).optional(),
      hero: z.object({ title: z.string(), lead: z.string() }),
      sections: z.array(
        z.object({
          heading: z.string(),
          numbered: z.boolean().default(false),
          items: z.array(z.object({ t: z.string(), d: z.string() })),
        }),
      ),
      statement: z.object({ text: z.string(), sub: z.string().optional() }).optional(),
      legal: z.array(z.object({ t: z.string(), d: z.string(), href: z.string() })).optional(),
    }),
});

// Web products: a tile on the home page that links out to the product's own site.
const products = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/products' }),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      tagline: z.string(),
      summary: z.string(),
      url: z.string().url(),
      kind: z.string(),
      icon: image(),
      shot: image(),
      order: z.number(),
    }),
});

// Build notes. The body is the post.
const posts = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
  }),
});

export const collections = { apps, products, posts };
