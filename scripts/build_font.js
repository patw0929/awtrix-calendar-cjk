/**
 * Build Script: Generates assets/cjk_font.bin from upstream BDF fonts
 *
 * Sources:
 * - Fusion Pixel Font (TakWolf): 8px monospaced Japanese & Korean BDFs
 *
 * Merges:
 * - 14,719 CJK Unified Ideographs (Traditional & Simplified Chinese, Kanji)
 * - 177 Japanese Kana (Hiragana, Katakana, Chouonpu, Sokwon)
 * - 11,172 Korean Hangul syllables (U+AC00 ~ U+D7A3, 100% of modern Hangul)
 * Total: 26,068 glyphs (229 KB binary, sorted by Unicode code point for binary search)
 */

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const ASSETS_DIR = path.join(ROOT_DIR, "assets");
const OUTPUT_BIN = path.join(ASSETS_DIR, "cjk_font.bin");

function bdfTo7Rows(bbx, bitmapLines) {
  const [w, h, xoff, yoff] = bbx;
  const rows = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 7; i++) {
    const y = 5 - i; // y goes from 5 down to -1
    if (y >= yoff && y < yoff + h) {
      const lineIdx = (yoff + h - 1) - y;
      if (lineIdx >= 0 && lineIdx < bitmapLines.length) {
        rows[i] = parseInt(bitmapLines[lineIdx], 16);
      }
    }
  }
  return rows;
}

const glyphMap = new Map();

function parseBdf(filePath, condition) {
  if (!fs.existsSync(filePath)) {
    console.error("BDF file not found:", filePath);
    return;
  }
  console.log("Parsing", path.basename(filePath), "...");
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  let curCode = null;
  let curBbx = null;
  let inBitmap = false;
  let curRows = [];

  for (let line of lines) {
    line = line.trim();
    if (line.startsWith("ENCODING ")) {
      curCode = parseInt(line.split(" ")[1], 10);
    } else if (line.startsWith("BBX ")) {
      curBbx = line.split(" ").slice(1).map(Number);
    } else if (line === "BITMAP") {
      if (curCode && condition(curCode)) {
        inBitmap = true;
        curRows = [];
      }
    } else if (line === "ENDCHAR") {
      if (inBitmap && curBbx) {
        if (!glyphMap.has(curCode)) {
          const rows = bdfTo7Rows(curBbx, curRows);
          glyphMap.set(curCode, rows);
        }
      }
      inBitmap = false;
      curCode = null;
      curBbx = null;
    } else if (inBitmap) {
      curRows.push(line);
    }
  }
}

// Check local tmp or allow path args
const jaBdf = process.argv[2] || "/tmp/fusion-pixel-8px-monospaced-ja.bdf";
const koBdf = process.argv[3] || "/tmp/fusion-pixel-8px-monospaced-ko.bdf";

// 1. Japanese Kana and CJK
parseBdf(jaBdf, code => (code >= 0x3040 && code <= 0x30FF) || (code >= 0x4E00 && code <= 0x9FFF));

// 2. Korean Hangul and CJK
parseBdf(koBdf, code => (code >= 0xAC00 && code <= 0xD7AF) || (code >= 0x4E00 && code <= 0x9FFF));

console.log("Total unique glyphs:", glyphMap.size);

const sortedCodes = Array.from(glyphMap.keys()).sort((a, b) => a - b);
const buf = Buffer.alloc(sortedCodes.length * 9);
for (let i = 0; i < sortedCodes.length; i++) {
  const code = sortedCodes[i];
  const rows = glyphMap.get(code);
  const offset = i * 9;
  buf.writeUInt16BE(code, offset);
  for (let r = 0; r < 7; r++) {
    buf[offset + 2 + r] = rows[r];
  }
}

fs.mkdirSync(ASSETS_DIR, { recursive: true });
fs.writeFileSync(OUTPUT_BIN, buf);
console.log("Generated:", OUTPUT_BIN, "(" + (buf.length / 1024).toFixed(1) + " KB)");
