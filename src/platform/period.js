// Calendar-day periods in a named time zone. A period is [local midnight, next local midnight),
// so DST days are 23 or 25 hours long rather than a fixed 86400 seconds.

const fmtCache = new Map();
function formatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(
      tz,
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    );
  }
  return fmtCache.get(tz);
}

function localParts(ts, tz) {
  const p = Object.fromEntries(formatter(tz).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second };
}

function offsetMs(ts, tz) {
  const p = localParts(ts, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(ts / 1000) * 1000;
}

export function localDate(ts, tz) {
  const p = localParts(ts, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function localMidnightUtc(dateStr, tz) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d);
  let ts = wall - offsetMs(wall, tz);
  ts = wall - offsetMs(ts, tz);
  return ts;
}

export function isPeriodId(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s;
}

export function periodBounds(periodId, tz) {
  return {
    period_id: periodId,
    starts_at: localMidnightUtc(periodId, tz),
    ends_at: localMidnightUtc(addDays(periodId, 1), tz),
  };
}

export function periodAt(ts, tz) {
  return periodBounds(localDate(ts, tz), tz);
}
