/**
 * AWTRIX Google Calendar CJK Proxy (Cloudflare Worker - CDN Edition)
 * Fetches Google Calendar iCal, expands recurring events, formats a multi-language
 * agenda, and rasterizes CJK, Japanese (Kana/Kanji), and Korean (Hangul) text into
 * 8px dot-matrix columns.
 *
 * Font binary (26,068 glyphs) is loaded from CDN and cached at Cloudflare edge.
 *
 * @author patw (based on Mvrcl1005)
 * @license MIT
 */

// @@FONT_LOADER_START
// Font binary: Japanese Kana (0x3041..) -> CJK Ideographs (0x4E00..) -> Korean Hangul (0xAC00..)
// CDN font configuration
const FONT_URL_PRIMARY = "https://cdn.jsdelivr.net/gh/patw0929/awtrix-calendar-cjk@master/assets/cjk_font.bin";
const FONT_URL_FALLBACK = "https://raw.githubusercontent.com/patw0929/awtrix-calendar-cjk/master/assets/cjk_font.bin";

let _fontBuf = null;

async function getFontBuf(env) {
  if (_fontBuf) return _fontBuf;
  const candidates = [
    env?.FONT_URL,
    FONT_URL_PRIMARY,
    FONT_URL_FALLBACK
  ].filter(Boolean);

  let lastError = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        cf: { cacheEverything: true, cacheTtl: 604800 }
      });
      if (res.ok) {
        _fontBuf = new Uint8Array(await res.arrayBuffer());
        return _fontBuf;
      }
      lastError = new Error("HTTP " + res.status);
    } catch (err) {
      lastError = err;
    }
  }
  throw new HttpError(503, "Failed to load font from CDN: " + (lastError?.message || "Unknown error"));
}
// @@FONT_LOADER_END

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function lookupCJK(code, buf) {
  if (!buf || code > 0xFFFF) return null;
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
  let resp;
  try {
    resp = await fetch(url, {
      headers: { "User-Agent": "TC002-Awtrix/1.0" }
    });
  } catch (err) {
    throw new HttpError(503, "iCal fetch failed: " + err.message);
  }
  if (!resp.ok) {
    // 4xx = wrong / revoked URL (permanent), 5xx = Google hiccup (retry later)
    throw new HttpError(resp.status >= 500 ? 503 : 400, "Google Error: " + resp.status);
  }
  const text = await resp.text();
  _icsCache = { text, url, timestamp: now };
  return text;
}

// ---------------------------------------------------------------------------
// Time helpers
//
// A "wall" value is the wall-clock time in some zone, encoded as if it were a
// UTC timestamp (ms). This lets us do calendar arithmetic with Date.UTC and
// convert to a real instant only when needed.
// ---------------------------------------------------------------------------

const DAY_MS = 86400000;

const _cachedFormatters = {};
function getTzFormatter(tz) {
  if (!_cachedFormatters[tz]) {
    _cachedFormatters[tz] = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "numeric", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hourCycle: "h23"
    });
  }
  return _cachedFormatters[tz];
}

function isValidTz(tz) {
  try {
    getTzFormatter(tz);
    return true;
  } catch (e) {
    return false;
  }
}

function wallMs(instantMs, tz) {
  const parts = getTzFormatter(tz).formatToParts(new Date(instantMs));
  const get = type => parseInt(parts.find(p => p.type === type).value, 10);
  let h = get("hour");
  if (h === 24) h = 0;
  return Date.UTC(get("year"), get("month") - 1, get("day"), h, get("minute"), get("second"));
}

// Two passes so times next to a DST transition resolve to the right offset.
function wallToInstant(wall, tz) {
  if (tz === "UTC") return wall;
  const off1 = wallMs(wall, tz) - wall;
  let inst = wall - off1;
  const off2 = wallMs(inst, tz) - inst;
  if (off2 !== off1) inst = wall - off2;
  return inst;
}

function dayNum(wall) { return Math.floor(wall / DAY_MS); }
function dayFromYmd(y, m, d) { return Math.floor(Date.UTC(y, m, d) / DAY_MS); }
function ymdFromDay(dn) {
  const d = new Date(dn * DAY_MS);
  return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
}
function daysInMonth(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
function weekday(dn) { return (((dn % 7) + 7) % 7 + 4) % 7; } // 1970-01-01 was a Thursday (4)

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

function jsonResponse(obj, status, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    }, extraHeaders || {})
  });
}

export default {
  async fetch(request, env) {
    const t0 = Date.now();
    const url = new URL(request.url);
    const icalUrl = url.searchParams.get("ical") || env?.ICAL_URL;

    if (!icalUrl) {
      return jsonResponse({ error: "Missing required 'ical' parameter. Please provide your Google Calendar secret iCal URL." }, 400);
    }

    const tz = (url.searchParams.get("tz") || "Asia/Taipei").trim();
    if (!isValidTz(tz)) {
      return jsonResponse({ error: "Invalid time zone: " + tz }, 400);
    }
    const lang = url.searchParams.get("lang") || url.searchParams.get("locale") || url.searchParams.get("style") || "en";

    let daysParam = parseInt(url.searchParams.get("days") || "14", 10);
    if (!Number.isFinite(daysParam)) daysParam = 14;
    let maxParam = parseInt(url.searchParams.get("max") || "8", 10);
    if (!Number.isFinite(maxParam) || maxParam < 1) maxParam = 8;
    if (maxParam > 50) maxParam = 50;

    try {
      const tFetch0 = Date.now();
      const [icsText, fontBuf] = await Promise.all([
        fetchIcsText(icalUrl),
        getFontBuf(env)
      ]);
      const tFetch1 = Date.now();

      const nowMs = Date.now();
      const todayDay = dayNum(wallMs(nowMs, tz));
      const todayStartMs = wallToInstant(todayDay * DAY_MS, tz);
      // days <= 0 means "no limit"; still cap expansion of recurring events at one year
      const horizonDays = daysParam > 0 ? daysParam : 366;
      const cutoffMs = wallToInstant((todayDay + horizonDays) * DAY_MS, tz);

      const vevents = parseICS(icsText);
      const occurrences = buildOccurrences(vevents, tz, todayStartMs, cutoffMs);
      const tParse1 = Date.now();

      const upcoming = occurrences
        .filter(o => {
          if (o.start >= cutoffMs) return false;
          return o.isAllDay ? o.end > todayStartMs : o.end > nowMs;
        })
        .sort((a, b) => (a.start - b.start) || (b.isAllDay - a.isAllDay))
        .slice(0, maxParam);

      const result = upcoming.map(o => {
        const timeStr = formatEventTime(o, tz, lang, todayDay, todayStartMs);
        return {
          time: timeStr,
          title: o.summary,
          time_cols: renderStringTo8pxCols(timeStr, fontBuf),
          title_cols: renderStringTo8pxCols(o.summary, fontBuf)
        };
      });

      const tRender1 = Date.now();
      const timingHeader = "fetch;dur=" + (tFetch1 - tFetch0) + ", parse;dur=" + (tParse1 - tFetch1) + ", render;dur=" + (tRender1 - tParse1) + ", total;dur=" + (tRender1 - t0);

      return jsonResponse({ events: result }, 200, {
        // Private: the response contains calendar data and the request URL contains a secret
        "Cache-Control": "private, max-age=120",
        "Connection": "close",
        "Server-Timing": timingHeader
      });
    } catch (err) {
      return jsonResponse({ error: err.message }, err.status || 500);
    }
  }
};

// ---------------------------------------------------------------------------
// ICS parsing (RFC 5545)
// ---------------------------------------------------------------------------

function splitOutsideQuotes(s, sep) {
  const out = [];
  let inQ = false;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\"") inQ = !inQ;
    else if (c === sep && !inQ) {
      out.push(s.substring(last, i));
      last = i + 1;
    }
  }
  out.push(s.substring(last));
  return out;
}

// "DTSTART;TZID=Asia/Taipei:20250101T090000" -> { name, params, value }
function parseContentLine(line) {
  let inQ = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\"") inQ = !inQ;
    else if (c === ":" && !inQ) { colon = i; break; }
  }
  if (colon < 0) return null;
  const segs = splitOutsideQuotes(line.substring(0, colon), ";");
  const params = {};
  for (let i = 1; i < segs.length; i++) {
    const eq = segs[i].indexOf("=");
    if (eq > 0) {
      params[segs[i].substring(0, eq).toUpperCase()] = segs[i].substring(eq + 1).replace(/^"|"$/g, "");
    }
  }
  return { name: segs[0].toUpperCase(), params, value: line.substring(colon + 1) };
}

function unescapeText(s) {
  return s
    .replace(/\\([\\;,nN])/g, (m, c) => (c === "n" || c === "N") ? " " : c)
    .replace(/\s+/g, " ")
    .trim();
}

// -> { wall, isDate, utc, tzid } or null
function parseDateValue(value, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const isDate = !m[4] || (params && params.VALUE === "DATE");
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3],
    isDate ? 0 : +m[4], isDate ? 0 : +m[5], isDate ? 0 : +(m[6] || 0));
  return { wall, isDate, utc: !isDate && !!m[7], tzid: (params && params.TZID) || null };
}

function parseDuration(value) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return null;
  const ms = (+(m[2] || 0) * 7 + +(m[3] || 0)) * DAY_MS +
    (+(m[4] || 0) * 3600 + +(m[5] || 0) * 60 + +(m[6] || 0)) * 1000;
  return m[1] === "-" ? -ms : ms;
}

const WEEKDAY_CODES = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRRule(value) {
  const rule = {
    freq: null, interval: 1, count: 0, until: null,
    byday: [], bymonthday: [], bymonth: [], bysetpos: [], wkst: 1
  };
  const ints = v => v.split(",").map(x => parseInt(x, 10)).filter(Number.isFinite);
  for (const part of value.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.substring(0, eq).trim().toUpperCase();
    const v = part.substring(eq + 1).trim().toUpperCase();
    if (k === "FREQ") rule.freq = v;
    else if (k === "INTERVAL") rule.interval = Math.max(1, parseInt(v, 10) || 1);
    else if (k === "COUNT") rule.count = Math.max(0, parseInt(v, 10) || 0);
    else if (k === "UNTIL") rule.until = parseDateValue(v, null);
    else if (k === "BYMONTHDAY") rule.bymonthday = ints(v);
    else if (k === "BYMONTH") rule.bymonth = ints(v);
    else if (k === "BYSETPOS") rule.bysetpos = ints(v);
    else if (k === "WKST" && v in WEEKDAY_CODES) rule.wkst = WEEKDAY_CODES[v];
    else if (k === "BYDAY") {
      for (const d of v.split(",")) {
        const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(d.trim());
        if (m && m[2] in WEEKDAY_CODES) rule.byday.push({ n: m[1] ? parseInt(m[1], 10) : 0, wd: WEEKDAY_CODES[m[2]] });
      }
    }
  }
  return rule;
}

function parseICS(text) {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const events = [];
  let cur = null;
  let depth = 0; // nested components inside VEVENT (VALARM ...)

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line === "BEGIN:VEVENT") {
      cur = { summary: null, exdates: [] };
      depth = 0;
      continue;
    }
    if (!cur) continue;
    if (line === "END:VEVENT") {
      if (cur.dtstart) events.push(cur);
      cur = null;
      continue;
    }
    if (line.startsWith("BEGIN:")) { depth++; continue; }
    if (line.startsWith("END:")) { depth = Math.max(0, depth - 1); continue; }
    if (depth > 0) continue;

    const p = parseContentLine(line);
    if (!p) continue;
    switch (p.name) {
      case "SUMMARY": cur.summary = unescapeText(p.value); break;
      case "DTSTART": cur.dtstart = parseDateValue(p.value, p.params); break;
      case "DTEND": cur.dtend = parseDateValue(p.value, p.params); break;
      case "DURATION": cur.duration = parseDuration(p.value); break;
      case "RRULE": cur.rrule = parseRRule(p.value); break;
      case "EXDATE":
        for (const v of p.value.split(",")) {
          const d = parseDateValue(v, p.params);
          if (d) cur.exdates.push(d);
        }
        break;
      case "RECURRENCE-ID": cur.recurrenceId = parseDateValue(p.value, p.params); break;
      case "STATUS": cur.status = p.value.trim().toUpperCase(); break;
      case "UID": cur.uid = p.value.trim(); break;
    }
  }
  return events;
}

// Zone in which a date value's wall clock is interpreted
function zoneOf(dv, defaultTz) {
  if (dv.isDate) return defaultTz;
  if (dv.utc) return "UTC";
  if (dv.tzid && isValidTz(dv.tzid)) return dv.tzid;
  return defaultTz;
}

function toInstant(dv, defaultTz) {
  return dv.utc ? dv.wall : wallToInstant(dv.wall, zoneOf(dv, defaultTz));
}

// ---------------------------------------------------------------------------
// Recurrence expansion
// ---------------------------------------------------------------------------

function monthOk(rule, dn) {
  return !rule.bymonth.length || rule.bymonth.includes(ymdFromDay(dn)[1] + 1);
}

function applySetPos(rule, days) {
  if (!rule.bysetpos.length || !days.length) return days;
  const out = [];
  for (const pos of rule.bysetpos) {
    const d = pos > 0 ? days[pos - 1] : days[days.length + pos];
    if (d !== undefined && !out.includes(d)) out.push(d);
  }
  return out.sort((a, b) => a - b);
}

// Candidate days of month (y, m) for MONTHLY / YEARLY+BYMONTH rules
function monthDays(rule, y, m, defaultDay) {
  const dim = daysInMonth(y, m);
  const first = dayFromYmd(y, m, 1);
  let set = null;
  if (rule.bymonthday.length) {
    set = [];
    for (const md of rule.bymonthday) {
      const d = md > 0 ? md : dim + md + 1;
      if (d >= 1 && d <= dim) set.push(first + d - 1);
    }
  }
  if (rule.byday.length) {
    const byd = [];
    for (const b of rule.byday) {
      const all = [];
      for (let d = 0; d < dim; d++) if (weekday(first + d) === b.wd) all.push(first + d);
      if (b.n) {
        const pick = b.n > 0 ? all[b.n - 1] : all[all.length + b.n];
        if (pick !== undefined) byd.push(pick);
      } else {
        byd.push(...all);
      }
    }
    set = set ? set.filter(d => byd.includes(d)) : byd;
  }
  if (!set) set = defaultDay <= dim ? [first + defaultDay - 1] : []; // e.g. the 31st is skipped in short months
  return [...new Set(set)].sort((a, b) => a - b);
}

// YEARLY;BYDAY without BYMONTH: weekdays counted within the whole year
function yearDays(rule, y) {
  const first = dayFromYmd(y, 0, 1);
  const len = dayFromYmd(y + 1, 0, 1) - first;
  const out = [];
  for (const b of rule.byday) {
    const all = [];
    for (let d = 0; d < len; d++) if (weekday(first + d) === b.wd) all.push(first + d);
    if (b.n) {
      const pick = b.n > 0 ? all[b.n - 1] : all[all.length + b.n];
      if (pick !== undefined) out.push(pick);
    } else {
      out.push(...all);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function monthDayMatches(bymonthday, dn) {
  const [y, m, d] = ymdFromDay(dn);
  const dim = daysInMonth(y, m);
  return bymonthday.some(md => (md > 0 ? md : dim + md + 1) === d);
}

// Period k of the rule -> { startDay, days: sorted candidate day numbers }
function periodCandidates(rule, k, startDay) {
  const [sy, sm, sd] = ymdFromDay(startDay);
  const iv = rule.interval;
  switch (rule.freq) {
    case "DAILY": {
      const dn = startDay + k * iv;
      const ok = monthOk(rule, dn) &&
        (!rule.byday.length || rule.byday.some(b => b.wd === weekday(dn))) &&
        (!rule.bymonthday.length || monthDayMatches(rule.bymonthday, dn));
      return { startDay: dn, days: ok ? [dn] : [] };
    }
    case "WEEKLY": {
      const weekStart = startDay - ((weekday(startDay) - rule.wkst + 7) % 7) + k * 7 * iv;
      const wds = rule.byday.length ? rule.byday.map(b => b.wd) : [weekday(startDay)];
      const days = [];
      for (let i = 0; i < 7; i++) {
        const dn = weekStart + i;
        if (wds.includes(weekday(dn)) && monthOk(rule, dn)) days.push(dn);
      }
      return { startDay: weekStart, days: applySetPos(rule, days) };
    }
    case "MONTHLY": {
      const mi = sm + k * iv;
      const y = sy + Math.floor(mi / 12);
      const m = ((mi % 12) + 12) % 12;
      const first = dayFromYmd(y, m, 1);
      if (rule.bymonth.length && !rule.bymonth.includes(m + 1)) return { startDay: first, days: [] };
      return { startDay: first, days: applySetPos(rule, monthDays(rule, y, m, sd)) };
    }
    case "YEARLY": {
      const y = sy + k * iv;
      const first = dayFromYmd(y, 0, 1);
      let days;
      if (rule.bymonth.length) {
        days = [];
        for (const mo of rule.bymonth) days.push(...monthDays(rule, y, mo - 1, sd));
        days.sort((a, b) => a - b);
      } else if (rule.byday.length && !rule.bymonthday.length) {
        days = yearDays(rule, y);
      } else {
        days = monthDays(rule, y, sm, sd); // same month/day every year (Feb 29 only in leap years)
      }
      return { startDay: first, days: applySetPos(rule, days) };
    }
    default:
      return null; // HOURLY / MINUTELY / SECONDLY are not supported
  }
}

const MAX_PERIOD_DAYS = { DAILY: 1, WEEKLY: 7, MONTHLY: 31, YEARLY: 366 };

/**
 * Expand an RRULE in wall-clock space.
 * Returns start walls in [fromWall, toWall), honouring COUNT and UNTIL from DTSTART.
 */
function expandRRule(rule, startWall, fromWall, toWall, beyondUntil) {
  const out = [];
  if (!MAX_PERIOD_DAYS[rule.freq]) return out;
  const startDay = dayNum(startWall);
  const tod = startWall - startDay * DAY_MS;

  // Without COUNT we can jump close to the window instead of walking from DTSTART
  let k = 0;
  if (!rule.count) {
    const gap = dayNum(fromWall) - startDay;
    if (gap > 0) k = Math.max(0, Math.floor(gap / (rule.interval * MAX_PERIOD_DAYS[rule.freq])) - 1);
  }

  let count = 0;
  for (let iter = 0; iter < 20000; iter++, k++) {
    const p = periodCandidates(rule, k, startDay);
    if (!p || p.startDay * DAY_MS >= toWall) break;
    for (const dn of p.days) {
      if (dn < startDay) continue;
      const w = dn * DAY_MS + tod;
      if (beyondUntil(w) || w >= toWall) return out;
      count++;
      if (w >= fromWall) out.push(w);
      if (rule.count && count >= rule.count) return out;
    }
  }
  return out;
}

function makeUntilCheck(until, zone) {
  if (!until) return () => false;
  if (until.isDate) {
    const lastDay = dayNum(until.wall);
    return w => dayNum(w) > lastDay;
  }
  if (until.utc) {
    // Cheap bounds first (offsets never exceed ±14h), exact conversion only near the edge
    return w => {
      if (w < until.wall - DAY_MS) return false;
      if (w > until.wall + DAY_MS) return true;
      return wallToInstant(w, zone) > until.wall;
    };
  }
  return w => w > until.wall;
}

/**
 * Turn parsed VEVENTs into concrete occurrences overlapping [windowStart, windowEnd).
 * Handles RRULE, EXDATE, RECURRENCE-ID overrides and STATUS:CANCELLED.
 */
function buildOccurrences(vevents, defaultTz, windowStart, windowEnd) {
  // Instances replaced by a RECURRENCE-ID override (or cancelled) are removed from the series
  const overridden = new Map();
  for (const ev of vevents) {
    if (!ev.recurrenceId || !ev.uid) continue;
    const zone = ev.recurrenceId.tzid || ev.recurrenceId.utc || ev.recurrenceId.isDate
      ? zoneOf(ev.recurrenceId, defaultTz)
      : zoneOf(ev.dtstart, defaultTz);
    const inst = ev.recurrenceId.utc ? ev.recurrenceId.wall : wallToInstant(ev.recurrenceId.wall, zone);
    if (!overridden.has(ev.uid)) overridden.set(ev.uid, new Set());
    overridden.get(ev.uid).add(inst);
  }

  const out = [];
  for (const ev of vevents) {
    if (ev.status === "CANCELLED") continue;
    const ds = ev.dtstart;
    const isAllDay = ds.isDate;
    const zone = zoneOf(ds, defaultTz);
    const summary = ev.summary || "(No Title)";

    // Duration: all-day in whole days, timed in ms
    let durDays = 1;
    let durMs = 3600000;
    if (isAllDay) {
      if (ev.dtend) durDays = dayNum(ev.dtend.wall) - dayNum(ds.wall);
      else if (ev.duration != null) durDays = Math.round(ev.duration / DAY_MS);
      if (durDays < 1) durDays = 1;
    } else if (ev.dtend) {
      // Same zone: wall difference is enough (avoids Intl calls for every past event)
      durMs = zoneOf(ev.dtend, defaultTz) === zone
        ? ev.dtend.wall - ds.wall
        : toInstant(ev.dtend, defaultTz) - toInstant(ds, defaultTz);
    } else if (ev.duration != null) {
      durMs = ev.duration;
    }
    if (durMs < 0) durMs = 0;
    const spanMs = isAllDay ? durDays * DAY_MS : durMs;

    // Window in wall space with a day of slack for zone offsets
    const fromWall = windowStart - spanMs - DAY_MS;
    const toWall = windowEnd + DAY_MS;

    const emit = w => {
      let start, end;
      if (isAllDay) {
        start = wallToInstant(w, defaultTz);
        end = wallToInstant(w + durDays * DAY_MS, defaultTz);
      } else {
        start = ds.utc ? w : wallToInstant(w, zone);
        end = start + durMs;
      }
      return { start, end, isAllDay, summary };
    };

    if (!ev.rrule || ev.recurrenceId) {
      if (ds.wall < fromWall || ds.wall >= toWall) continue;
      out.push(emit(ds.wall));
      continue;
    }

    const skip = new Set(ev.exdates.map(d => toInstant(d, defaultTz)));
    const over = (ev.uid && overridden.get(ev.uid)) || null;
    const walls = expandRRule(ev.rrule, ds.wall, fromWall, toWall, makeUntilCheck(ev.rrule.until, zone));
    for (const w of walls) {
      const occ = emit(w);
      if (skip.has(occ.start) || (over && over.has(occ.start))) continue;
      out.push(occ);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Agenda text
// ---------------------------------------------------------------------------

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

const LOCALE_ALIASES = { "Chinese": "zh-TW", "zh": "zh-TW", "English": "en", "Japanese": "ja", "Korean": "ko" };

function resolveLocale(locale) {
  let norm = (locale || "en").trim();
  norm = LOCALE_ALIASES[norm] || norm;
  return LOCALES[norm] || LOCALES["en"];
}

function pad2(n) { return (n < 10 ? "0" : "") + n; }

function formatEventTime(occ, timeZone, locale, todayDay, todayStartMs) {
  const conf = resolveLocale(locale);
  const w = wallMs(occ.start, timeZone);
  const dn = dayNum(w);
  const [, mo, d] = ymdFromDay(dn);
  const m = mo + 1;
  const tod = w - dn * DAY_MS;
  const time = pad2(Math.floor(tod / 3600000)) + ":" + pad2(Math.floor((tod % 3600000) / 60000));
  const diffDays = dn - todayDay;
  const wk = conf.weekdays[weekday(dn)];

  // Multi-day all-day event that started before today and is still going on
  if (occ.isAllDay && occ.start < todayStartMs) return conf.today;

  if (diffDays === 0) {
    return occ.isAllDay ? conf.today : time;
  }
  if (diffDays === 1) {
    return occ.isAllDay ? conf.tmr : conf.tmrPrefix + time;
  }
  if (diffDays > 1 && diffDays < 7) {
    if (occ.isAllDay) return wk + " " + m + "/" + d;
    return wk + " " + time;
  }

  if (occ.isAllDay) return m + "/" + d;
  return m + "/" + d + " " + time;
}

// ---------------------------------------------------------------------------
// Rasterizer: each column is one byte, bit 0 = top row, 7 rows high
// ---------------------------------------------------------------------------

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
  "\"": [0x07, 0x00, 0x07],
  "#": [0x14, 0x7F, 0x14, 0x7F, 0x14],
  "$": [0x24, 0x2A, 0x7F, 0x2A, 0x12],
  "&": [0x36, 0x49, 0x55, 0x22, 0x50],
  "'": [0x05, 0x03],
  "(": [0x1C, 0x22, 0x41],
  ")": [0x41, 0x22, 0x1C],
  "*": [0x08, 0x2A, 0x1C, 0x2A, 0x08],
  "+": [0x08, 0x08, 0x3E, 0x08, 0x08],
  ";": [0x56, 0x36],
  "<": [0x08, 0x14, 0x22, 0x41],
  "=": [0x14, 0x14, 0x14, 0x14, 0x14],
  ">": [0x41, 0x22, 0x14, 0x08],
  "@": [0x32, 0x49, 0x79, 0x41, 0x3E],
  "[": [0x7F, 0x41, 0x41],
  "\\": [0x02, 0x04, 0x08, 0x10, 0x20],
  "]": [0x41, 0x41, 0x7F],
  "^": [0x04, 0x02, 0x01, 0x02, 0x04],
  "_": [0x40, 0x40, 0x40, 0x40, 0x40],
  "`": [0x01, 0x02],
  "{": [0x08, 0x36, 0x41],
  "|": [0x7F],
  "}": [0x41, 0x36, 0x08],
  "~": [0x10, 0x08, 0x08, 0x10, 0x08],
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

// CJK / typographic punctuation not covered by the font binary
const PUNCT_5x7 = {
  0x3000: [0, 0, 0, 0, 0],          // ideographic space
  0x3001: [0x10, 0x20, 0x40],       // 、
  0x3002: [0x20, 0x50, 0x20],       // 。
  0x300C: [0x1F, 0x01],             // 「
  0x300D: [0x40, 0x7C],             // 」
  0x300E: [0x3F, 0x21, 0x03],       // 『
  0x300F: [0x60, 0x42, 0x7E],       // 』
  0x3010: [0x7F, 0x63, 0x41],       // 【
  0x3011: [0x41, 0x63, 0x7F],       // 】
  0x2026: [0x40, 0x00, 0x40, 0x00, 0x40], // …
  0x00B7: [0x08],                   // ·
  0x2027: [0x08],                   // ‧
  0x2022: [0x1C, 0x1C, 0x1C],       // •
  0x00B0: [0x06, 0x09, 0x06],       // °
  0x2013: [0x08, 0x08, 0x08, 0x08], // –
  0x2014: [0x08, 0x08, 0x08, 0x08, 0x08, 0x08], // —
  0x2015: [0x08, 0x08, 0x08, 0x08, 0x08, 0x08]  // ―
};
const PUNCT_ALIAS = {
  0x3008: "<", 0x3009: ">", 0x300A: "<", 0x300B: ">", 0x301C: "~",
  0x2018: "'", 0x2019: "'", 0x201C: "\"", 0x201D: "\"", 0x301D: "\"", 0x301E: "\""
};
const BOX_GLYPH = [0x7E, 0x42, 0x42, 0x42, 0x42, 0x7E, 0];

// Zero-width joiner, variation selectors, emoji skin tones: draw nothing
function isInvisible(cp) {
  return cp === 0x200B || cp === 0x200D || (cp >= 0xFE00 && cp <= 0xFE0F) || (cp >= 0x1F3FB && cp <= 0x1F3FF);
}

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

function glyphCols(ch, cp, fontBuf) {
  if (Object.prototype.hasOwnProperty.call(ASCII_5x7, ch)) return ASCII_5x7[ch].concat(0);
  if (cp >= 0x20 && cp <= 0x7E) return renderAsciiChar(ch).concat(0);
  const cjkRows = lookupCJK(cp, fontBuf);
  if (cjkRows) return rowsToCols(cjkRows);
  if (cp >= 0xFF01 && cp <= 0xFF5E) {
    // Full-width ASCII forms （ ） ： ！ ？ ， ... -> half-width glyph
    const half = String.fromCharCode(cp - 0xFEE0);
    return glyphCols(half, cp - 0xFEE0, fontBuf);
  }
  if (PUNCT_ALIAS[cp]) return glyphCols(PUNCT_ALIAS[cp], PUNCT_ALIAS[cp].charCodeAt(0), fontBuf);
  if (PUNCT_5x7[cp]) return PUNCT_5x7[cp].concat(0);
  return BOX_GLYPH;
}

function renderStringTo8pxCols(str, fontBuf) {
  const cols = [];
  for (const ch of str) { // iterates code points, so emoji count as one glyph
    const cp = ch.codePointAt(0);
    if (isInvisible(cp)) continue;
    const g = glyphCols(ch, cp, fontBuf);
    for (let i = 0; i < g.length; i++) cols.push(g[i]);
  }
  return cols;
}

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

function renderAsciiChar(ch) {
  return FONT_A_Z[ch.toUpperCase()] || BOX_GLYPH.slice(0, 6);
}
