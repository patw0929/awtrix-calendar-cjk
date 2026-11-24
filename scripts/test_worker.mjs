/**
 * Regression tests for worker/worker.js (no network, no dependencies).
 *   node scripts/test_worker.mjs [worker/worker.standalone.js]
 * Builds an ICS relative to "now" and checks the agenda the worker returns.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Optional argument: path of the worker to test (default worker/worker.js)
const workerPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, "worker", "worker.js");
const src = fs.readFileSync(workerPath, "utf8");
const worker = (await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"))).default;
const font = fs.readFileSync(path.join(ROOT, "assets", "cjk_font.bin"));

const TZ = "Asia/Taipei";
const pad = n => String(n).padStart(2, "0");
// Calendar date in Taipei, k days from today
function taipeiDate(k) {
  const d = new Date(Date.now() + 8 * 3600000 + k * 86400000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay() };
}
const ymd = k => { const t = taipeiDate(k); return `${t.y}${pad(t.m)}${pad(t.d)}`; };
const local = (k, hh) => `${ymd(k)}T${pad(hh)}0000`;
const WD = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function vevent(props) {
  return ["BEGIN:VEVENT", ...props, "END:VEVENT"];
}
// Fold like Google does: 75 octets per line, continuation lines start with a space
function fold(line) {
  const out = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 75) { out.push(cur); cur = " "; }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n");
}

const LONG = "這是一個很長很長很長很長很長很長很長很長很長的會議標題需要折行才放得下";
const in3 = taipeiDate(3);

const ics = [
  "BEGIN:VCALENDAR",
  "BEGIN:VTIMEZONE", "TZID:Asia/Taipei", "BEGIN:STANDARD", "DTSTART:19700101T000000", "END:STANDARD", "END:VTIMEZONE",
  // Daily, started 30 days ago at 23:00 Taipei; one instance (tomorrow) excluded
  ...vevent(["UID:daily", `DTSTART;TZID=Asia/Taipei:${local(-30, 23)}`, `DTEND;TZID=Asia/Taipei:${ymd(-30)}T233000`,
    "RRULE:FREQ=DAILY", `EXDATE;TZID=Asia/Taipei:${local(1, 23)}`, "SUMMARY:Daily standup"]),
  // Weekly on the weekday 3 days from now, started 10 weeks ago, 10:00
  ...vevent(["UID:weekly", `DTSTART;TZID=Asia/Taipei:${local(3 - 70, 10)}`, `DTEND;TZID=Asia/Taipei:${local(3 - 70, 11)}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${WD[in3.wd]}`, "SUMMARY:Weekly sync"]),
  // Override: this week's "Weekly sync" moved to 15:00
  ...vevent(["UID:weekly", `RECURRENCE-ID;TZID=Asia/Taipei:${local(3, 10)}`, `DTSTART;TZID=Asia/Taipei:${local(3, 15)}`,
    `DTEND;TZID=Asia/Taipei:${local(3, 16)}`, "SUMMARY:Weekly sync (moved)"]),
  // Weekly with COUNT that already ended
  ...vevent(["UID:ended", `DTSTART;TZID=Asia/Taipei:${local(-70, 9)}`, "RRULE:FREQ=WEEKLY;COUNT=3", "SUMMARY:Ended series"]),
  // Weekly with UNTIL in the past
  ...vevent(["UID:until", `DTSTART:${ymd(-70)}T010000Z`, `RRULE:FREQ=WEEKLY;UNTIL=${ymd(-7)}T000000Z`, "SUMMARY:Until series"]),
  // Multi-day all-day trip: started yesterday, ends after tomorrow
  ...vevent(["UID:trip", `DTSTART;VALUE=DATE:${ymd(-1)}`, `DTEND;VALUE=DATE:${ymd(3)}`, "SUMMARY:Trip"]),
  // Long CJK title, folded
  ...vevent(["UID:long", `DTSTART;TZID=Asia/Taipei:${local(2, 11)}`, fold(`SUMMARY:${LONG}`)]),
  // Created in New York: 09:00 NY = 21:00 or 22:00 Taipei
  ...vevent(["UID:ny", `DTSTART;TZID=America/New_York:${local(4, 9)}`, `DTEND;TZID=America/New_York:${local(4, 10)}`, "SUMMARY:NY meeting"]),
  // Punctuation + emoji
  ...vevent(["UID:punct", `DTSTART;TZID=Asia/Taipei:${local(5, 12)}`, "SUMMARY;LANGUAGE=zh-TW:午餐（公司）、「討論」🎉 (Lunch)\\, ok"]),
  // Cancelled
  ...vevent(["UID:cancel", `DTSTART;TZID=Asia/Taipei:${local(5, 13)}`, "STATUS:CANCELLED", "SUMMARY:Cancelled"]),
  // Monthly on the last weekday of the month (expanded; may fall outside the window)
  ...vevent(["UID:monthly", `DTSTART;TZID=Asia/Taipei:${local(-400, 8)}`, "RRULE:FREQ=MONTHLY;BYDAY=-1FR", "SUMMARY:Last Friday"]),
  "END:VCALENDAR"
].join("\r\n");

globalThis.fetch = async u => String(u).includes("font") ? new Response(font) : new Response(ics);

async function call(params) {
  const q = new URLSearchParams(Object.assign({ ical: "https://cal.example/a.ics", lang: "en", tz: TZ, days: "14", max: "50" }, params));
  const res = await worker.fetch(new Request("https://w.example/?" + q), { FONT_URL: "https://font.example" });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

let failed = 0;
function check(name, cond, detail) {
  console.log((cond ? "  ok   " : "  FAIL ") + name + (cond || detail === undefined ? "" : "  → " + JSON.stringify(detail)));
  if (!cond) failed++;
}

const { status, body, headers } = await call({});
check("status 200", status === 200, body);
const evs = body.events || [];
const titles = evs.map(e => e.title);
const find = t => evs.filter(e => e.title === t);
console.log(evs.map(e => `    ${e.time.padEnd(12)} ${e.title}`).join("\n"));

const daily = find("Daily standup");
check("daily recurring event is expanded", daily.length >= 12, daily.length);
check("EXDATE removes tomorrow's standup", !daily.some(e => e.time === "Tmr 23:00"), daily.map(e => e.time));
check("weekly instance this week was overridden", find("Weekly sync (moved)").length === 1 && find("Weekly sync").length === 1, titles);
check("override keeps its own time", (find("Weekly sync (moved)")[0] || {}).time?.endsWith("15:00"), find("Weekly sync (moved)"));
check("weekly next week keeps original time", (find("Weekly sync")[0] || {}).time?.endsWith("10:00"), find("Weekly sync"));
check("COUNT-limited series that ended is gone", !titles.includes("Ended series"));
check("UNTIL in the past ends series", !titles.includes("Until series"));
check("ongoing multi-day all-day event shows as Today", (find("Trip")[0] || {}).time === "Today", find("Trip"));
check("folded SUMMARY is unfolded", titles.includes(LONG), titles);
const ny = find("NY meeting")[0] || {};
check("TZID honoured (NY 09:00 → Taipei 21:00/22:00)", /2[12]:00$/.test(ny.time || ""), ny.time);
check("SUMMARY with params + escapes", titles.includes("午餐（公司）、「討論」🎉 (Lunch), ok"), titles);
check("cancelled event hidden", !titles.includes("Cancelled"));
check("Cache-Control is private", headers.get("Cache-Control").startsWith("private"));

// Rendering: punctuation should no longer fall back to the box glyph
const punct = find("午餐（公司）、「討論」🎉 (Lunch), ok")[0];
if (punct) {
  const box = [0x7E, 0x42, 0x42, 0x42, 0x42, 0x7E];
  const s = JSON.stringify(punct.title_cols);
  const boxCount = s.split(JSON.stringify(box).slice(1, -1)).length - 1;
  check("only the emoji renders as a box", boxCount === 1, boxCount);
}

// Error handling
const badTz = await call({ tz: "Mars/Olympus" });
check("invalid tz → 400", badTz.status === 400, badTz);
const plusTz = await call({ tz: "Etc/GMT+8" });
check("Etc/GMT+8 works when URL-encoded", plusTz.status === 200, plusTz.body);

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
