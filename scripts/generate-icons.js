'use strict';

/**
 * Rasterize favicon.svg into the inputs @capacitor/assets expects.
 * The mark is the same abyss triangle as the browser favicon.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'assets');
const svg = fs.readFileSync(path.join(root, 'favicon.svg'));

const markOnly = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<path d="M16 5 L27 26 H5 Z" fill="#8a2018"/>' +
    '<path d="M16 11 L22 25 H10 Z" fill="#e8c080"/>' +
  '</svg>'
);

async function png(width, height, background) {
  return sharp({
    create: {
      width: width,
      height: height,
      channels: 4,
      background: background,
    },
  });
}

async function centered(source, canvas, markSize) {
  const mark = await sharp(source)
    .resize(markSize, markSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  return canvas.composite([{ input: mark, gravity: 'centre' }]).png();
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const ink = '#140c0c';
  const abyss = '#0a0708';

  await (await centered(svg, await png(1024, 1024, ink), 760))
    .toFile(path.join(outDir, 'icon-only.png'));
  await (await centered(markOnly, await png(1024, 1024, { r: 0, g: 0, b: 0, alpha: 0 }), 620))
    .toFile(path.join(outDir, 'icon-foreground.png'));
  await (await png(1024, 1024, ink)).png().toFile(path.join(outDir, 'icon-background.png'));

  const splash = await centered(markOnly, await png(2732, 2732, abyss), 880);
  const splashBuf = await splash.toBuffer();
  fs.writeFileSync(path.join(outDir, 'splash.png'), splashBuf);
  fs.writeFileSync(path.join(outDir, 'splash-dark.png'), splashBuf);
  console.log('Wrote Capacitor icon and splash sources in assets/.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
