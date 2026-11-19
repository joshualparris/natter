// calendar_events tool: reads your Google Calendar via its secret iCal address (read-only).
import ical from "node-ical";
import { guard, body, TZ } from "../_lib.js";

// UTC Date for local midnight of YYYY-MM-DD in the given time zone.
export function zonedMidnight(dateStr, tz = TZ) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(guess)).map((p) => [p.type, p.value]),
  );
  const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return new Date(guess - (asLocal - guess));
}

function localDate(tz = TZ, offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function eventsBetween(data, from, to) {
  const out = [];
  for (const ev of Object.values(data)) {
    if (!ev || ev.type !== "VEVENT" || ev.status === "CANCELLED") continue;
    const dur = ev.end && ev.start ? ev.end - ev.start : 3600000;
    const allDay = ev.datetype === "date";
    if (ev.rrule) {
      // Expand with a day of slack, then filter precisely.
      const starts = ev.rrule.between(new Date(from - 86400000), new Date(+to + 86400000), true);
      for (const s of starts) {
        const key = s.toISOString().slice(0, 10);
        const ex = ev.exdate && Object.values(ev.exdate).some((x) => x.toISOString().slice(0, 10) === key);
        if (ex) continue;
        const override = ev.recurrences && ev.recurrences[key];
        const start = override ? override.start : s;
        const end = override && override.end ? override.end : new Date(+s + dur);
        if (override && override.status === "CANCELLED") continue;
        if (end > from && start < to) out.push({ summary: (override || ev).summary, start, end, allDay, location: (override || ev).location });
      }
    } else if (ev.start && ev.start < to && new Date(+ev.start + dur) > from) {
      out.push({ summary: ev.summary, start: ev.start, end: ev.end, allDay, location: ev.location });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function describe(events, tz = TZ) {
  if (!events.length) return "No events in that range.";
  const day = new Intl.DateTimeFormat("en-AU", { timeZone: tz, weekday: "long", day: "numeric", month: "long" });
  const time = new Intl.DateTimeFormat("en-AU", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  return events.slice(0, 40).map((e) => {
    const when = e.allDay ? `${day.format(e.start)} (all day)` : `${day.format(e.start)} ${time.format(e.start)}–${time.format(e.end)}`;
    const name = typeof e.summary === "object" ? e.summary.val : e.summary;
    const loc = e.location ? ` at ${typeof e.location === "object" ? e.location.val : e.location}` : "";
    return `${when}: ${name || "(no title)"}${loc}`;
  }).join("\n");
}

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const url = process.env.GOOGLE_CALENDAR_ICS_URL;
  if (!url) return res.status(501).json({ error: "Calendar isn't connected (GOOGLE_CALENDAR_ICS_URL not set)." });
  const b = body(req);
  const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const startStr = isDate(b.start_date) ? b.start_date : localDate();
  const endStr = isDate(b.end_date) ? b.end_date : startStr;
  const from = zonedMidnight(startStr);
  const to = new Date(+zonedMidnight(endStr) + 86400000);
  if (to - from > 62 * 86400000) return res.status(400).json({ error: "Ask for two months or less." });
  try {
    const r = await fetch(url);
    if (!r.ok) return res.status(502).json({ error: `Calendar fetch failed (${r.status}).` });
    const data = ical.sync.parseICS(await r.text());
    return res.status(200).json({ result: `Events from ${startStr} to ${endStr} (Sydney time):\n${describe(eventsBetween(data, from, to))}` });
  } catch (e) {
    return res.status(502).json({ error: "Couldn't read the calendar." });
  }
}
