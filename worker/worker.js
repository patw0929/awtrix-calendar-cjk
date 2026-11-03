/**
 * AWTRIX Google Calendar CJK Proxy (Cloudflare Worker - CDN Edition)
 * Fetches Google Calendar iCal, formats multi-language agenda, and rasterizes
 * CJK, Japanese (Kana/Kanji), and Korean (Hangul) text into 8px dot-matrix columns.
 *
 * Font binary (26,068 glyphs) is loaded from CDN and cached at Cloudflare edge.
 *
 * @author patw (based on Mvrcl1005)
 * @license MIT
 */
// Font binary: Japanese Kana (0x3041..) -> CJK Ideographs (0x4E00..) -> Korean Hangul (0xAC00..)
// CDN font configuration
const FONT_URL_PRIMARY = "https://cdn.jsdelivr.net/gh/patw0929/awtrix-calendar-cjk@master/assets/cjk_font.bin";
const FONT_URL_FALLBACK = "https://raw.githubusercontent.com/patw0929/awtrix-calendar-cjk/master/assets/cjk_font.bin";

let _fontBuf = null;

async function getFontBuf(env) {
  if (_fontBuf) return _fontBuf;
  const targetUrl = env?.FONT_URL || FONT_URL_PRIMARY;
  try {
    const res = await fetch(targetUrl, {
      cf: { cacheEverything: true, cacheTtl: 604800 }
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    _fontBuf = new Uint8Array(await res.arrayBuffer());
    return _fontBuf;
  } catch (err) {
    if (targetUrl === FONT_URL_PRIMARY) {
      const fb = await fetch(FONT_URL_FALLBACK);
      if (fb.ok) {
        _fontBuf = new Uint8Array(await fb.arrayBuffer());
        return _fontBuf;
      }
    }
    throw new Error("Failed to load font from CDN (" + targetUrl + "): " + err.message);
  }
}

  function lookupCJK(code, buf) {
    if (!buf) return null;
    let low = 0;
    let high = (buf.length / 9) - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const pos = mid * 9;
      const c = (buf[pos] << 8) | buf[pos + 1];
      if (c === code) {
        return [
          buf[pos + 2], buf[pos + 3], buf[pos + 4],
          buf[pos + 5], buf[pos + 6], buf[pos + 7],
          buf[pos + 8]
        ];
      }
      if (c < code) low = mid + 1;
      else high = mid - 1;
    }
    return null;
  }

  // In-memory cache: 2.5 minutes (150,000ms) to prevent repeated fetches from Google that could cause timeouts
  let _icsCache = { text: null, url: null, timestamp: 0 };

  async function fetchIcsText(url) {
    const now = Date.now();
    if (_icsCache.text && _icsCache.url === url && (now - _icsCache.timestamp < 150000)) {
      return _icsCache.text;
    }
    const resp = await fetch(url, {
      headers: { "User-Agent": "TC002-Awtrix/1.0" }
    });
    if (!resp.ok) {
      throw new Error("Google Error: " + resp.status);
    }
    const text = await resp.text();
    _icsCache = { text, url, timestamp: now };
    return text;
  }

  let _cachedFormatters = {};
  function getTzFormatter(tz) {
    if (!_cachedFormatters[tz]) {
      _cachedFormatters[tz] = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric", month: "numeric", day: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false
      });
    }
    return _cachedFormatters[tz];
  }

  export default {
    async fetch(request, env) {
      const t0 = Date.now();
      const url = new URL(request.url);
      const icalUrl = url.searchParams.get("ical") || env.ICAL_URL;

      if (!icalUrl) {
        return new Response(JSON.stringify({ error: "Missing required 'ical' parameter. Please provide your Google Calendar secret iCal URL." }), {
          status: 400,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      }

      const tz = url.searchParams.get("tz") || "Asia/Taipei";
      const lang = url.searchParams.get("lang") || url.searchParams.get("locale") || url.searchParams.get("style") || "en";

      try {
        const tFetch0 = Date.now();
        const [icsText, fontBuf] = await Promise.all([
          fetchIcsText(icalUrl),
          getFontBuf(env)
        ]);
        const tFetch1 = Date.now();

        const events = parseICS(icsText, tz);
        const tParse1 = Date.now();

        const nowParts = getTzFormatter(tz).formatToParts(new Date());
        const nowY = parseInt(nowParts.find(p => p.type === "year")?.value, 10);
        const nowM = parseInt(nowParts.find(p => p.type === "month")?.value, 10) - 1;
        const nowD = parseInt(nowParts.find(p => p.type === "day")?.value, 10);

        const todayStart = parseDateTimeInZone(nowY, nowM, nowD, 0, 0, 0, tz);

        const daysParam = parseInt(url.searchParams.get("days") || "14", 10);
        const cutoff = daysParam > 0 ? new Date(todayStart.getTime() + daysParam * 24 * 3600 * 1000) : null;
        const maxParam = parseInt(url.searchParams.get("max") || "8", 10);

        const nowTime = Date.now();

        const upcoming = events
          .filter(ev => {
            if (cutoff && ev.start >= cutoff) return false;
            if (ev.isAllDay) return ev.start >= todayStart;
            return ev.end.getTime() >= nowTime;
          })
          .slice(0, maxParam);

        const result = upcoming.map(ev => {
          const timeStr = formatEventTime(ev.start, ev.isAllDay, tz, lang);
          const timeCols = renderStringTo8pxCols(timeStr, fontBuf);
          const titleCols = renderStringTo8pxCols(ev.summary, fontBuf);
          return {
            time: timeStr,
            title: ev.summary,
            time_cols: timeCols,
            title_cols: titleCols
          };
        });

        const tRender1 = Date.now();
        const timingHeader = "fetch;dur=" + (tFetch1 - tFetch0) + ", parse;dur=" + (tParse1 - tFetch1) + ", render;dur=" + (tRender1 - tParse1) + ", total;dur=" + (tRender1 - t0);

        return new Response(JSON.stringify({ events: result }), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=120",
            "Connection": "close",
            "Server-Timing": timingHeader
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      }
    }
  };

  function parseICS(text, defaultTz) {
    const lines = text.split(String.fromCharCode(10)).map(l => l.trim());
    const events = [];
    let cur = null;
    let inAlarm = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === "BEGIN:VEVENT") {
        cur = { summary: "(No Title)", isAllDay: false, start: null, end: null };
        inAlarm = false;
      } else if (line === "END:VEVENT") {
        if (cur && cur.start) {
          if (!cur.end) cur.end = new Date(cur.start.getTime() + (cur.isAllDay ? 86400000 : 3600000));
          events.push(cur);
        }
        cur = null;
        inAlarm = false;
      } else if (line === "BEGIN:VALARM") {
        inAlarm = true;
      } else if (line === "END:VALARM") {
        inAlarm = false;
      } else if (cur && !inAlarm) {
        if (line.startsWith("SUMMARY:")) {
          cur.summary = line.substring(8).replace(/\\,/g, ",").replace(/\\;/g, ";").trim();
        } else if (line.startsWith("DTSTART")) {
          cur.isAllDay = line.indexOf("VALUE=DATE") !== -1 || (line.indexOf(":") !== -1 && line.substring(line.indexOf(":") + 1).length === 8);
          const idx = line.indexOf(":");
          if (idx !== -1) cur.start = parseICSDate(line.substring(idx + 1), cur.isAllDay, defaultTz);
        } else if (line.startsWith("DTEND")) {
          const idx = line.indexOf(":");
          if (idx !== -1) cur.end = parseICSDate(line.substring(idx + 1), cur.isAllDay, defaultTz);
        }
      }
    }

    events.sort((a, b) => a.start - b.start);
    return events;
  }

  function parseICSDate(str, isAllDay, tz) {
    if (!str) return new Date();
    str = str.trim();
    const y = parseInt(str.substr(0, 4), 10);
    const m = parseInt(str.substr(4, 2), 10) - 1;
    const d = parseInt(str.substr(6, 2), 10);
    if (isAllDay || str.length === 8) {
      return parseDateTimeInZone(y, m, d, 0, 0, 0, tz);
    }
    const hh = parseInt(str.substr(9, 2), 10);
    const mm = parseInt(str.substr(11, 2), 10);
    const ss = parseInt(str.substr(13, 2), 10);
    if (str.endsWith("Z")) {
      return new Date(Date.UTC(y, m, d, hh, mm, ss));
    }
    return parseDateTimeInZone(y, m, d, hh, mm, ss, tz);
  }

  function parseDateTimeInZone(y, m, d, hh, mm, ss, tz) {
    const naive = new Date(Date.UTC(y, m, d, hh, mm, ss));
    try {
      const parts = getTzFormatter(tz).formatToParts(naive);
      const getPart = type => parts.find(p => p.type === type)?.value;
      let py = parseInt(getPart("year"), 10);
      let pm = parseInt(getPart("month"), 10) - 1;
      let pd = parseInt(getPart("day"), 10);
      let ph = parseInt(getPart("hour"), 10);
      if (ph === 24) ph = 0;
      let pmin = parseInt(getPart("minute"), 10);
      let ps = parseInt(getPart("second"), 10);

      const inTzUtc = Date.UTC(py, pm, pd, ph, pmin, ps);
      const diff = inTzUtc - naive.getTime();
      return new Date(naive.getTime() - diff);
    } catch (e) {
      return naive;
    }
  }

  function formatEventTime(date, isAllDay, timeZone, locale) {
    try {
      const parts = getTzFormatter(timeZone).formatToParts(date);
      const getPart = type => parts.find(p => p.type === type)?.value;
      const y = parseInt(getPart("year"), 10);
      const m = parseInt(getPart("month"), 10);
      const d = parseInt(getPart("day"), 10);
      let hh = getPart("hour");
      if (hh === "24") hh = "00";
      const mm = getPart("minute");

      const nowParts = getTzFormatter(timeZone).formatToParts(new Date());
      const nowY = parseInt(nowParts.find(p => p.type === "year")?.value, 10);
      const nowM = parseInt(nowParts.find(p => p.type === "month")?.value, 10);
      const nowD = parseInt(nowParts.find(p => p.type === "day")?.value, 10);

      const nowDate = new Date(Date.UTC(nowY, nowM - 1, nowD));
      const evDate = new Date(Date.UTC(y, m - 1, d));
      const diffDays = Math.round((evDate - nowDate) / (24 * 3600 * 1000));
      const dayOfWeek = evDate.getUTCDay();

      const LOCALES = {
        "en": {
          weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
          today: "Today",
          tmr: "Tmr",
          tmrPrefix: "Tmr "
        },
        "zh-TW": {
          weekdays: ["週日", "週一", "週二", "週三", "週四", "週五", "週六"],
          today: "今天",
          tmr: "明天",
          tmrPrefix: "明 "
        },
        "zh-CN": {
          weekdays: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
          today: "今天",
          tmr: "明天",
          tmrPrefix: "明 "
        },
        "ja": {
          weekdays: ["日", "月", "火", "水", "木", "金", "土"],
          today: "今日",
          tmr: "明日",
          tmrPrefix: "明 "
        },
        "ko": {
          weekdays: ["일", "월", "화", "수", "목", "금", "토"],
          today: "오늘",
          tmr: "내일",
          tmrPrefix: "내 "
        }
      };

      let norm = (locale || "en").trim();
      if (norm === "Chinese" || norm === "zh") norm = "zh-TW";
      if (norm === "English") norm = "en";
      if (norm === "Japanese") norm = "ja";
      if (norm === "Korean") norm = "ko";

      const conf = LOCALES[norm] || LOCALES["en"];
      const wk = conf.weekdays[dayOfWeek];
      const time = hh + ":" + mm;

      if (diffDays === 0) {
        return isAllDay ? conf.today : time;
      }
      if (diffDays === 1) {
        if (isAllDay) return conf.tmr;
        return conf.tmrPrefix + time;
      }
      if (diffDays > 1 && diffDays < 7) {
        if (isAllDay) return wk + " " + m + "/" + d;
        return wk + " " + time;
      }

      if (isAllDay) return m + "/" + d;
      return m + "/" + d + " " + time;
    } catch (e) {
      return isAllDay ? "Today" : "12:00";
    }
  }

  const ASCII_5x7 = {
    " ": [0, 0, 0],
    ":": [0, 0x24, 0],
    "-": [0x08, 0x08, 0x08, 0x08],
    "/": [0x40, 0x20, 0x10, 0x08, 0x04],
    ".": [0x40, 0x00],
    ",": [0x40, 0x20],
    "!": [0x5F, 0x00],
    "?": [0x02, 0x01, 0x51, 0x09, 0x06],
    "%": [0x23, 0x13, 0x08, 0x64, 0x62],
    "0": [0x3E, 0x51, 0x49, 0x45, 0x3E],
    "1": [0x00, 0x42, 0x7F, 0x40, 0x00],
    "2": [0x42, 0x61, 0x51, 0x49, 0x46],
    "3": [0x21, 0x41, 0x45, 0x4B, 0x31],
    "4": [0x18, 0x14, 0x12, 0x7F, 0x10],
    "5": [0x27, 0x45, 0x45, 0x45, 0x39],
    "6": [0x3C, 0x4A, 0x49, 0x49, 0x30],
    "7": [0x01, 0x71, 0x09, 0x05, 0x03],
    "8": [0x36, 0x49, 0x49, 0x49, 0x36],
    "9": [0x06, 0x49, 0x49, 0x29, 0x1E]
  };

  function rowsToCols(rows) {
    const cols = [];
    for (let x = 0; x < 7; x++) {
      let colByte = 0;
      for (let y = 0; y < rows.length; y++) {
        if ((rows[y] & (0x80 >> x)) !== 0) {
          colByte |= (1 << y);
        }
      }
      cols.push(colByte);
    }
    cols.push(0);
    return cols;
  }

  function renderStringTo8pxCols(str, fontBuf) {
    let cols = [];
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      const code = ch.charCodeAt(0);

      if (ASCII_5x7[ch]) {
        cols = cols.concat(ASCII_5x7[ch]);
        cols.push(0);
      } else if (code >= 0x20 && code <= 0x7E) {
        const baseCol = renderAsciiChar(ch);
        cols = cols.concat(baseCol);
        cols.push(0);
      } else {
        const cjkRows = lookupCJK(code, fontBuf);
        if (cjkRows) {
          cols = cols.concat(rowsToCols(cjkRows));
        } else {
          cols = cols.concat([0x7E, 0x42, 0x42, 0x42, 0x42, 0x7E, 0]);
        }
      }
    }
    return cols;
  }

  function renderAsciiChar(ch) {
    const c = ch.toUpperCase();
    const FONT_A_Z = {
      "A": [0x7E, 0x09, 0x09, 0x09, 0x7E], "B": [0x7F, 0x49, 0x49, 0x49, 0x36],
      "C": [0x3E, 0x41, 0x41, 0x41, 0x22], "D": [0x7F, 0x41, 0x41, 0x22, 0x1C],
      "E": [0x7F, 0x49, 0x49, 0x49, 0x41], "F": [0x7F, 0x09, 0x09, 0x09, 0x01],
      "G": [0x3E, 0x41, 0x49, 0x49, 0x7A], "H": [0x7F, 0x08, 0x08, 0x08, 0x7F],
      "I": [0x00, 0x41, 0x7F, 0x41, 0x00], "J": [0x20, 0x40, 0x41, 0x3F, 0x01],
      "K": [0x7F, 0x08, 0x14, 0x22, 0x41], "L": [0x7F, 0x40, 0x40, 0x40, 0x40],
      "M": [0x7F, 0x02, 0x0C, 0x02, 0x7F], "N": [0x7F, 0x04, 0x08, 0x10, 0x7F],
      "O": [0x3E, 0x41, 0x41, 0x41, 0x3E], "P": [0x7F, 0x09, 0x09, 0x09, 0x06],
      "Q": [0x3E, 0x41, 0x51, 0x21, 0x5E], "R": [0x7F, 0x09, 0x19, 0x29, 0x46],
      "S": [0x46, 0x49, 0x49, 0x49, 0x31], "T": [0x01, 0x01, 0x7F, 0x01, 0x01],
      "U": [0x3F, 0x40, 0x40, 0x40, 0x3F], "V": [0x1F, 0x20, 0x40, 0x20, 0x1F],
      "W": [0x7F, 0x20, 0x18, 0x20, 0x7F], "X": [0x63, 0x14, 0x08, 0x14, 0x63],
      "Y": [0x07, 0x08, 0x70, 0x08, 0x07], "Z": [0x61, 0x51, 0x49, 0x45, 0x43]
    };
    return FONT_A_Z[c] || [0x7F, 0x41, 0x41, 0x41, 0x7F];
  }
