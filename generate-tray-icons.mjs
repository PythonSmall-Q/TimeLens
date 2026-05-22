#!/usr/bin/env node
/**
 * Generate tray-ready monochrome icon variants.
 * Run: node generate-tray-icons.mjs
 */

import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_BLACK = path.join(__dirname, 'src-tauri', 'icons', 'tray-black.png');
const OUT_WHITE = path.join(__dirname, 'src-tauri', 'icons', 'tray-white.png');

function buildTemplateSvg(color) {
  // 32x32 transparent tray glyph based on TimeLens brand motif:
  // clock dial + hands + magnifier handle.
  return `
<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <g fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="14" cy="14" r="9.5" stroke-width="2.1" />
    <circle cx="14" cy="14" r="7.6" stroke-width="1.3" opacity="0.5" />
    <path d="M14 7.6V6.2M14 21.8V20.4M7.6 14H6.2M21.8 14H20.4" stroke-width="1.8" opacity="0.9" />
    <path d="M14 14L10.5 11.7" stroke-width="2.1" />
    <path d="M14 14L18.9 11.1" stroke-width="2.1" />
    <path d="M14 14L11.3 18.9" stroke-width="1.5" opacity="0.9" />
    <circle cx="14" cy="14" r="1.15" fill="${color}" stroke="none" />
    <path d="M20.8 20.8L26.3 26.3" stroke-width="3" />
  </g>
</svg>
`.trim();
}

async function writeTrayIcon(color, outPath) {
  const svg = buildTemplateSvg(color);
  await sharp(Buffer.from(svg, 'utf8'))
    .resize(32, 32, { fit: 'contain' })
    .png()
    .toFile(outPath);
}

async function generate() {
  await writeTrayIcon('#000000', OUT_BLACK);
  console.log('✔  Generated:', OUT_BLACK);

  await writeTrayIcon('#FFFFFF', OUT_WHITE);
  console.log('✔  Generated:', OUT_WHITE);
}

generate().catch((err) => {
  console.error('generate-tray-icons failed:', err);
  process.exit(1);
});
