// Renders public/logo.png: the Organization logo referenced from JSON-LD. Structured-data
// consumers want a raster/SVG at 112px or larger, and the favicon is an .ico, so this
// draws a 512px mark once with the same renderer and typeface the OG images use.
//
//   node scripts/make-logo.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import palette from '../src/lib/palette.json' with { type: 'json' };

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const inter = await fs.readFile(require.resolve('@fontsource/inter/files/inter-latin-600-normal.woff'));

const tree = {
  type: 'div',
  props: {
    style: {
      width: 512,
      height: 512,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: palette.ink,
      borderRadius: 112,
      color: palette.paper,
      fontFamily: 'Inter',
      fontSize: 320,
      fontWeight: 600,
      letterSpacing: '-0.04em',
      position: 'relative',
    },
    children: [
      { type: 'div', props: { style: { marginTop: -20 }, children: 'K' } },
      { type: 'div', props: { style: { position: 'absolute', right: 96, bottom: 96, width: 56, height: 56, borderRadius: 56, background: palette.accent } } },
    ],
  },
};

const svg = await satori(tree, {
  width: 512,
  height: 512,
  fonts: [{ name: 'Inter', data: inter, weight: 600, style: 'normal' }],
});
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 512 } }).render().asPng();
const out = path.join(ROOT, 'public/logo.png');
await fs.writeFile(out, png);
console.log(`wrote ${path.relative(ROOT, out)} (${png.length} bytes)`);
