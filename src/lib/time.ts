// Time handling. Health Auto Export writes "yyyy-MM-dd HH:mm:ss Z", e.g. "2024-02-06 14:30:00 -0800".
// We keep the instant in UTC and derive the local calendar day in the configured zone
// (America/Vancouver), so a trip to another time zone does not shift historical days.

const HAE_DATE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)? ?([+-])(\d{2}):?(\d{2})$/;

export interface ParsedInstant {
  utc: string; // ISO-8601 with Z
  offsetMin: number; // offset written by the device, minutes east of UTC
}

export function parseHaeDate(value: unknown): ParsedInstant | null {
  if (typeof value !== "string") return null;
  const m = HAE_DATE.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, sign, oh, om] = m;
  const offsetMin = (sign === "-" ? -1 : 1) * (Number(oh) * 60 + Number(om));
  const localMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (Number.isNaN(localMs)) return null;
  const date = new Date(localMs - offsetMin * 60_000);
  // Reject impossible dates like 2024-02-31 that Date.UTC would roll over.
  const check = new Date(localMs);
  if (check.getUTCDate() !== Number(d) || check.getUTCMonth() !== Number(mo) - 1) return null;
  return { utc: date.toISOString(), offsetMin };
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function localParts(utcIso: string | Date, timeZone: string) {
  const parts = formatter(timeZone).formatToParts(typeof utcIso === "string" ? new Date(utcIso) : utcIso);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), minute: Number(get("minute")) };
}

/** Calendar day (YYYY-MM-DD) of an instant in the given zone. */
export function localDate(utcIso: string | Date, timeZone: string): string {
  return localParts(utcIso, timeZone).date;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}
