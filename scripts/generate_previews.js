/**
 * Generates pixel-perfect SVG previews of the AWTRIX 52x16 / 64x16 LED matrix
 * for English, Traditional Chinese, Japanese, and Korean.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ASSETS_DIR = path.join(ROOT, "assets");
const fontBuf = fs.readFileSync(path.join(ASSETS_DIR, "cjk_font.bin"));

// Load worker helpers
let workerCode = fs.readFileSync(path.join(ROOT, "worker", "worker.js"), "utf8");
workerCode = workerCode.replace("export default", "globalThis.worker =");
eval(workerCode);

const DIGIT_FONT = [0x7B6F, 0x2C97, 0x73E7, 0x72CF, 0x5BC9, 0x79CF, 0x79EF, 0x7249, 0x7BEF, 0x7BCF];

function createMatrix(width = 64, height = 16) {
  const m = [];
  for (let y = 0; y < height; y++) {
    m.push(new Array(width).fill(null));
  }
  return m;
}

function setPixel(matrix, x, y, color) {
  if (x >= 0 && x < matrix[0].length && y >= 0 && y < matrix.length) {
    matrix[y][x] = color;
  }
}

function fillRect(matrix, x, y, w, h, color) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      setPixel(matrix, x + dx, y + dy, color);
    }
  }
}

function renderScreen(timeText, titleText, dayNum = 15) {
  const matrix = createMatrix(64, 16);

  // 1. Calendar icon (x=0..11, y=2..13)
  fillRect(matrix, 2, 4, 8, 8, "#B4B4B4");   // Base
  fillRect(matrix, 0, 2, 10, 2, "#4285F4");  // Top blue
  fillRect(matrix, 0, 4, 2, 8, "#4285F4");   // Left blue
  fillRect(matrix, 0, 2, 2, 2, "#1967D2");   // Top-left
  fillRect(matrix, 10, 2, 2, 10, "#FBBC04"); // Right yellow
  fillRect(matrix, 2, 12, 8, 2, "#34A853");  // Bottom green
  fillRect(matrix, 0, 12, 2, 2, "#188038");  // Bottom-left
  fillRect(matrix, 10, 12, 2, 2, "#EA4335"); // Dog ear
  setPixel(matrix, 11, 13, "#000000");

  // Digits inside icon
  const day1 = dayNum >= 10 ? DIGIT_FONT[Math.floor(dayNum / 10)] : -1;
  const day2 = DIGIT_FONT[dayNum % 10];
  for (let i = 0; i < 15; i++) {
    const bit = 1 << (14 - i);
    const px = i % 3;
    const py = Math.floor(i / 3);
    if (day1 >= 0) {
      if (day1 & bit) setPixel(matrix, 3 + px, 6 + py, "#1A73E8");
      if (day2 & bit) setPixel(matrix, 7 + px, 6 + py, "#1A73E8");
    } else {
      if (day2 & bit) setPixel(matrix, 5 + px, 6 + py, "#1A73E8");
    }
  }

  // 2. Top row (time/weekday) x=16..63, y=0..7
  const timeCols = renderStringTo8pxCols(timeText, fontBuf);
  const maxW = 46;
  for (let i = 0; i < Math.min(timeCols.length, maxW); i++) {
    const byte = timeCols[i];
    for (let bit = 0; bit < 8; bit++) {
      if (byte & (1 << bit)) {
        setPixel(matrix, 16 + i, bit, "#8AB4F8");
      }
    }
  }

  // 3. Bottom row (title) x=16..63, y=8..15
  const titleCols = renderStringTo8pxCols(titleText, fontBuf);
  for (let i = 0; i < Math.min(titleCols.length, maxW); i++) {
    const byte = titleCols[i];
    for (let bit = 0; bit < 8; bit++) {
      if (byte & (1 << bit)) {
        setPixel(matrix, 16 + i, 8 + bit, "#FFFFFF");
      }
    }
  }

  return matrix;
}

function matrixToSvg(matrix, titleLabel) {
  const width = matrix[0].length;
  const height = matrix.length;
  const ledSize = 10;
  const gap = 3;
  const pad = 16;
  const radius = ledSize / 2;

  const svgWidth = pad * 2 + width * ledSize + (width - 1) * gap;
  const svgHeight = pad * 2 + height * ledSize + (height - 1) * gap + 32;

  let circles = "";
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cx = pad + x * (ledSize + gap) + radius;
      const cy = pad + y * (ledSize + gap) + radius;
      const color = matrix[y][x];
      if (color) {
        // Glowing ON LED
        circles += `  <circle cx="${cx}" cy="${cy}" r="${radius}" fill="${color}" filter="url(#glow)"/>\n`;
        circles += `  <circle cx="${cx}" cy="${cy}" r="${radius * 0.7}" fill="#FFF" opacity="0.4"/>\n`;
      } else {
        // OFF LED
        circles += `  <circle cx="${cx}" cy="${cy}" r="${radius}" fill="#181a20"/>\n`;
      }
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}">
  <defs>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="1.5" result="blur" />
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <!-- Device Chassis -->
  <rect x="0" y="0" width="${svgWidth}" height="${svgHeight}" rx="14" fill="#0d0e12" stroke="#252830" stroke-width="2"/>
  <rect x="${pad - 4}" y="${pad - 4}" width="${svgWidth - (pad - 4) * 2}" height="${height * (ledSize + gap) - gap + 8}" rx="6" fill="#050608"/>

  <!-- Matrix LEDs -->
${circles}
  <!-- Label -->
  <text x="${svgWidth / 2}" y="${svgHeight - 12}" fill="#6b7280" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" text-anchor="middle" font-weight="500">${titleLabel}</text>
</svg>`;
}

const PREVIEWS = [
  { file: "preview_zh.svg", time: "週二 14:00", title: "專案會議", label: "繁體中文（Traditional Chinese）" },
  { file: "preview_ja.svg", time: "火 14:00", title: "定例会議", label: "日本語（Japanese）" },
  { file: "preview_ko.svg", time: "화 14:00", title: "주간 회의", label: "한국어（Korean）" },
  { file: "preview_en.svg", time: "Tue 14:00", title: "Team Sync", label: "English" }
];

for (const p of PREVIEWS) {
  const matrix = renderScreen(p.time, p.title, 15);
  const svg = matrixToSvg(matrix, p.label);
  const outPath = path.join(ASSETS_DIR, p.file);
  fs.writeFileSync(outPath, svg);
  console.log("Generated:", outPath);
}

