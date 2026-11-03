<div align="center">

![AWTRIX Google Calendar CJK Preview](assets/preview_en.svg)

# AWTRIX Google Calendar CJK

[![AWTRIX NG](https://img.shields.io/badge/AWTRIX-NG-blue.svg)](https://github.com/Blueforcer/awtrix-light)
[![Platform](https://img.shields.io/badge/Hardware-ESP32%20%7C%20Ulanzi%20TC002-orange.svg)]()
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare)](https://workers.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Font License: OFL 1.1](https://img.shields.io/badge/Font%20License-SIL%20OFL%201.1-green.svg)](https://scripts.sil.org/OFL)

[English](README.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

<p>An open-source Google Calendar live schedule app with full CJK (Chinese, Japanese, Korean) support, designed for <strong>Ulanzi TC002</strong> and other <strong>AWTRIX NG</strong> / <strong>ESP32</strong> pixel matrix displays.</p>

</div>

It solves the classic missing-glyph issue (`???` or blank rectangles) on memory-constrained microcontrollers by streaming dynamic 8px dot-matrix column bitmaps from a lightweight Cloudflare Worker proxy, supporting **Traditional & Simplified Chinese, Japanese (Kanji + Kana), and 100% of modern Korean (11,172 Hangul syllables)**.

---

## ✨ Features

> [!NOTE]
> **Dot-Matrix Legibility Notice**: Due to the physical constraint of an 8-pixel (8px) matrix height, characters with dense or complex strokes may be difficult to recognize clearly. Glyphs have been optimized as much as possible for dot-matrix rendering, and we appreciate your understanding.

- **Full East Asian Language Support**:
  - **Chinese**: Traditional & Simplified (14,719 CJK ideographs).
  - **Japanese**: Full Hiragana, Katakana, Chouonpu (`ー`), and Kanji.
  - **Korean**: **100% of all modern Hangul syllables** (11,172 characters from U+AC00 to U+D7A3).
- **Zero Privacy Leakage**: Your secret Google Calendar iCal URL is stored locally on your device and transmitted as a query parameter—never hardcoded into the Worker.
- **Two-Line Dynamic Layout**:
  - Top row: Formatted date, time, and localized weekday.
  - Bottom row: Event title with smooth marquee scrolling for long titles.
- **Rotary Knob & Manual Control**:
  - Rotate knob left/right to browse upcoming events at your own pace.
  - Press knob to return to the earliest event.
  - Configurable auto-cycle interval (set to `0` to disable auto-cycle for 100% manual knob operation).
- **Auto-Recovery & Connection Resilience**:
  - Visual retry countdown (`Retry 5s` → `Loading...`) on network hiccups.
  - Press top button at any time to force an immediate refresh.
  - Status indicators (`Loading...`, `Retry`, `Set Worker`, `Set iCal`) are vertically centered on the 16px screen.
- **Ultra-Fast & Edge Cached**:
  - In-memory 2.5-minute cache prevents redundant 300KB iCal downloads from Google.
  - Sub-50ms response times at Cloudflare edge.

---

## 🏗️ Architecture

```
┌─────────────────────────────────┐
│     Ulanzi TC002 / ESP32        │
│  (calendar_cjk.be Berry Script) │
└────────────────┬────────────────┘
                 │ HTTP GET ?ical=...&tz=...&lang=...
                 ▼
┌─────────────────────────────────┐
│       Cloudflare Worker         │
│     (worker/worker.js ~14KB)    │
└────────┬──────────────────────┬─┘
         │                      │
         │ Fetches & Caches     │ Fetches & Caches
         ▼                      ▼
┌──────────────────┐  ┌───────────────────────────────┐
│ Google Calendar  │  │   jsDelivr / GitHub CDN       │
│  (Private iCal)  │  │ (assets/cjk_font.bin ~229 KB) │
└──────────────────┘  └───────────────────────────────┘
```

1. **TC002** requests events with user preferences (timezone, language, max days).
2. **Cloudflare Worker** parses iCal, resolves recurring events, and rasterizes text into 8px column bytes using the binary font database.
3. **TC002** directly draws the column bitmaps to the matrix display without needing any font files stored in ESP32 flash memory.

---

## 🚀 Quick Start Guide

### Step 0: Obtain Your Secret Google Calendar iCal URL

Your AWTRIX clock requires your calendar's private iCal link to securely fetch upcoming events:

1. Open [Google Calendar](https://calendar.google.com/) in your web browser.
2. In the left sidebar under "My calendars", hover over your calendar, click the **three dots (⋮)** $\rightarrow$ **Settings and sharing**.
3. In the left navigation, click **Integrate calendar** (or scroll down to that section).
4. Find **Secret address in iCal format** and click the copy button.

> [!IMPORTANT]
> Make sure to copy the **Secret address in iCal format** (which typically contains `private-.../basic.ics`). **Do NOT** copy the "Public address", as non-public events will not be accessible.

---

### Step 1: Deploy Cloudflare Worker

Choose one of two deployment options:

#### Option A: CDN Edition (Recommended, ~14KB, ~4KB gzipped)
1. Fork or push this repository to your GitHub.
2. Open [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create application** → **Create Worker**.
3. Name your worker (e.g., `tc002-calendar`) and click **Deploy**.
4. Click **Edit code**, replace everything with the content of [`worker/worker.js`](worker/worker.js), and click **Deploy**.
   > *Note: By default, it loads the font from `https://cdn.jsdelivr.net/gh/patw0929/awtrix-calendar-cjk@master/assets/cjk_font.bin`. You can set an environment variable `FONT_URL` in Worker Settings if you host the font on your own domain or R2.*

#### Option B: Standalone Edition (Single file, no CDN needed)
If you don't want to use a CDN, copy [`worker/worker.standalone.js`](worker/worker.standalone.js) (which embeds the entire font database) and paste it into Cloudflare Worker.

---

### Step 2: Install Berry Script on AWTRIX NG

1. Open your AWTRIX device web interface in your browser (`http://<device-ip>/`).
2. Go to the **Scripts** tab in the top navigation bar.
3. Click the **`+`** button next to **SCRIPTS** to add a new script.
4. Paste the entire content of [`app/calendar_cjk.be`](app/calendar_cjk.be) into the code editor on the right.
5. Click **Save** (Save & Compile).

> [!TIP]
> **Legacy firmware users**: If your interface does not have a **Scripts** tab, navigate to **Files** → `/app` directory, create `calendar_cjk.be`, and paste the code there.

---

### Step 3: Configure Settings

In the AWTRIX web UI, go to **Apps** → **Google Calendar CJK**:

| Setting | Description | Default |
| :--- | :--- | :--- |
| **iCal URL** | Your secret Google Calendar iCal address (*Private address in iCal format*) | *(Required)* |
| **Worker URL** | Your deployed Cloudflare Worker URL (`https://<name>.<subdomain>.workers.dev`) | *(Required)* |
| **Language** | Weekday and relative date language: `zh-TW`, `zh-CN`, `en`, `ja`, `ko` | `zh-TW` |
| **Time zone** | Standard IANA time zone (e.g. `Asia/Taipei`, `Asia/Tokyo`, `America/New_York`) | `Asia/Taipei` |
| **Max future days** | How many days ahead to display events | `14` |
| **Auto cycle (sec)**| Seconds between events. **Set to `0` for manual knob-only control** | `8` |
| **Refresh interval**| Calendar sync interval in minutes | `15` |
| **Scroll speed** | Title marquee scroll speed percentage | `100` |
| **Time / day colour**| Hex color for date, time, and weekday | `#8AB4F8` |
| **Hide when empty** | Hide application when there are no upcoming events | `true` |

---

## 🎮 Controls

- **Turn Knob Right**: Next calendar event.
- **Turn Knob Left**: Previous calendar event.
- **Press Knob**: Reset to the first event.
- **Top Select Button**: Force an immediate refresh from Google Calendar.

---

## 🛠️ Building Font Binary from Source

The font binary `assets/cjk_font.bin` contains 26,068 pre-rendered glyphs extracted from TakWolf's open-source 8px BDF fonts:

```bash
node scripts/build_font.js /path/to/ja.bdf /path/to/ko.bdf
```

Format specification:
- Each glyph entry is **9 bytes**:
  - `bytes 0-1`: Unicode code point (16-bit Big-Endian).
  - `bytes 2-8`: 7 rows of 8-bit bitmap data.
- Entries are sorted by code point in ascending order, enabling $O(\log N)$ binary search in under 15 comparisons.

---

## 📄 License & Attribution

- Application code is licensed under the **[MIT License](LICENSE)** © 2026 patw.
- Based on [Google Calendar Agenda](https://awtrix.de/script/hmrKzlDZJrBm) by **[Mvrcl1005](https://awtrix.de/scripts/all?query=Mvrcl1005)**.
- Font glyphs derived from **[Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font)** by TakWolf, licensed under **SIL Open Font License 1.1**.
