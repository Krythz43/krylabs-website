// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Static HTML in ./dist, served by Caddy on the droplet (see Caddyfile) or server.js.
export default defineConfig({
  site: 'https://krylabs.com',
  integrations: [
    sitemap({
      // /bubblenest/download is a store-redirect stub and /og/* are images, not pages.
      filter: (page) => !page.includes('/bubblenest/download') && !page.includes('/og/'),
    }),
  ],
  // Dev-only toolbar pill clutters screenshots and is never in the static build.
  devToolbar: { enabled: false },
  build: {
    // Emit /about/index.html style pages so plain file serving resolves cleanly.
    format: 'directory',
  },
});
