// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Astro builds to static HTML in ./dist, which the Go backend serves.
export default defineConfig({
  site: 'https://krylabs.com',
  // /bubblenest/download is a store-redirect stub, not a page worth indexing.
  integrations: [sitemap({ filter: (page) => !page.includes('/bubblenest/download') })],
  // Dev-only toolbar pill clutters screenshots and is never in the static build.
  devToolbar: { enabled: false },
  build: {
    // Emit /about/index.html style pages so Go static serving resolves cleanly.
    format: 'directory',
  },
});
