// Open Graph images, rendered at build time. satori lays out a small element tree with
// the site's own typefaces, resvg rasterises the SVG, and the endpoint in
// src/pages/og/[slug].png.ts serves the PNG. No browser involved, so it runs on the droplet.
import fs from 'node:fs/promises';
import path from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';

const FONT_DIR = path.join(process.cwd(), 'src/assets/fonts/og');

export interface OgSpec {
  /** Small line above the title. */
  kicker: string;
  title: string;
  /** One sentence under the title. Keep it under ~110 characters. */
  description?: string;
  /** Path on disk of an app icon to show at the top left. */
  iconPath?: string;
  /** Paths on disk of up to three phone screenshots for the right-hand strip. */
  screenshotPaths?: string[];
}

const fontCache = new Map<string, Promise<ArrayBuffer>>();
function font(file: string): Promise<ArrayBuffer> {
  let p = fontCache.get(file);
  if (!p) {
    p = fs.readFile(path.join(FONT_DIR, file)).then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    fontCache.set(file, p);
  }
  return p;
}

// resvg decodes PNG and JPEG, not WebP, so screenshots are transcoded on the way in.
async function dataUri(file: string, width: number): Promise<string> {
  const buf = await sharp(file).resize({ width }).jpeg({ quality: 82 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

// satori takes React-shaped element objects; a tiny helper keeps the tree readable.
// A childless element must get `undefined`, not `[]`: satori treats any non-string,
// truthy `children` on a <div> as "has children" and then demands display: flex.
type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, props: Record<string, unknown>, ...children: unknown[]): Node => ({
  type,
  props: {
    ...props,
    children: children.length === 0 ? undefined : children.length === 1 ? children[0] : children,
  },
});

export async function renderOg(spec: OgSpec): Promise<Buffer> {
  const [inter, interBold, serif] = await Promise.all([
    font('Inter-Regular.ttf'),
    font('Inter-SemiBold.ttf'),
    font('InstrumentSerif-Regular.ttf'),
  ]);

  const shots = await Promise.all((spec.screenshotPaths ?? []).slice(0, 3).map((p) => dataUri(p, 300)));
  const icon = spec.iconPath ? await dataUri(spec.iconPath, 160) : null;
  const hasStrip = shots.length > 0;
  // Three lines of description is all the card has room for beside the strip
  // (about 32 characters a line at this size).
  const limit = hasStrip ? 92 : 150;
  const description = spec.description && spec.description.length > limit
    ? spec.description.slice(0, limit).replace(/\s+\S*$/, '') + '…'
    : spec.description;
  // With a strip, the text column stops where the phones start (three 200px shots with
  // 20px gaps, hanging 40px off the right edge, begin at x = 600).
  const columnWidth = hasStrip ? 580 : 1200;
  const textWidth = columnWidth - 72 - 20;

  const tree = h(
    'div',
    {
      style: {
        width: 1200,
        height: 630,
        display: 'flex',
        background: '#fbfbf9',
        color: '#17160f',
        fontFamily: 'Inter',
        position: 'relative',
        overflow: 'hidden',
      },
    },
    // Text column
    h(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          width: columnWidth,
          padding: '64px 0 56px 72px',
        },
      },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column' } },
        icon
          ? h('img', { src: icon, width: 80, height: 80, style: { borderRadius: 18, marginBottom: 28 } })
          : h('div', { style: { fontSize: 24, fontWeight: 600, marginBottom: 28 } }, 'Krylabs'),
        h('div', { style: { fontSize: 24, color: '#76746a', marginBottom: 18, maxWidth: textWidth } }, spec.kicker),
        h(
          'div',
          {
            style: {
              fontFamily: 'Instrument Serif',
              fontSize: spec.title.length > 34 ? 66 : 80,
              lineHeight: 1.02,
              letterSpacing: '-0.02em',
              maxWidth: hasStrip ? textWidth : 1000,
            },
          },
          spec.title,
        ),
        description
          ? h(
              'div',
              { style: { fontSize: 26, lineHeight: 1.4, color: '#34322a', marginTop: 26, maxWidth: hasStrip ? textWidth : 900 } },
              description,
            )
          : null,
      ),
    ),
    h(
      'div',
      { style: { position: 'absolute', left: 72, bottom: 56, display: 'flex', alignItems: 'center', fontSize: 22, color: '#76746a' } },
      h('div', { style: { width: 10, height: 10, borderRadius: 10, background: '#bf4d2e', marginRight: 14 } }),
      'krylabs.com',
    ),
    // Screenshot strip: three phones, overlapping the bottom edge so they read as a peek.
    hasStrip
      ? h(
          'div',
          {
            style: {
              position: 'absolute',
              right: -40,
              top: 84,
              display: 'flex',
              gap: 20,
              alignItems: 'flex-start',
            },
          },
          ...shots.map((src, i) =>
            h('img', {
              src,
              width: 200,
              style: {
                borderRadius: 26,
                border: '1px solid #d8d6cc',
                marginTop: i === 1 ? 54 : 0,
                boxShadow: '0 24px 60px rgba(23,22,15,0.18)',
              },
            }),
          ),
        )
      : null,
  );

  const svg = await satori(tree as never, {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'Inter', data: inter, weight: 400, style: 'normal' },
      { name: 'Inter', data: interBold, weight: 600, style: 'normal' },
      { name: 'Instrument Serif', data: serif, weight: 400, style: 'normal' },
    ],
  });

  return new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
}
