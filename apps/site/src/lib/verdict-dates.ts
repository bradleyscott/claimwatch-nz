// New Zealand date and time formatting for verdict pages (SITE-MVP §2.3):
// times render in NZ explicitly, because the rendering server may not be in NZ
// and a UTC server would date a 9pm Auckland broadcast to the previous day.
// Pure logic, unit-tested at L1.

/**
 * Times render in New Zealand time, explicitly. The server that renders these
 * pages is not necessarily in NZ (and a UTC server would date a 9pm Auckland
 * broadcast to the previous day) — so the zone is pinned here rather than left
 * to whatever the host happens to be set to. DST is IANA's business, not ours.
 */
export const NZ_ZONE = "Pacific/Auckland";

/** "9 Sep 2026" — the date a reader compares against the claim's own date. */
export function nzDate(date: Date, zone: string = NZ_ZONE): string {
  return date
    .toLocaleDateString("en-NZ", {
      timeZone: zone,
      day: "numeric",
      month: "short",
      year: "numeric",
    })
    .replace(/\u202f|\u00a0/g, " ");
}

/** "Tue 8 Sep" — the day label. */
export function nzDayLabel(date: Date): string {
  return date
    .toLocaleDateString("en-NZ", {
      timeZone: NZ_ZONE,
      weekday: "short",
      day: "numeric",
      month: "short",
    })
    .replace(/\u202f|\u00a0/g, " ")
    .replace(/,/g, "");
}

/** "7:42 am" — lowercase, narrow-space normalised, so tests can pin it. */
export function nzTimeLabel(date: Date): string {
  return date
    .toLocaleTimeString("en-NZ", { timeZone: NZ_ZONE, hour: "numeric", minute: "2-digit" })
    .replace(/\u202f|\u00a0/g, " ")
    .toLowerCase();
}

/** "2:40" — a clip offset as a reader reads it. */
export function clipOffset(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

/** Whole calendar days between two instants, counted in New Zealand days. */
export function nzDayGap(from: Date, to: Date): number {
  const asDay = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: NZ_ZONE }); // YYYY-MM-DD
  const start = Date.parse(`${asDay(from)}T00:00:00Z`);
  const end = Date.parse(`${asDay(to)}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

/** "the day after the claim", "the same day as the claim", "3 days after …". */
export function relativeToClaim(claimMadeAt: Date, checkedAt: Date): string {
  const days = nzDayGap(claimMadeAt, checkedAt);
  if (days === 0) return "the same day as the claim";
  if (days === 1) return "the day after the claim";
  if (days > 1) return `${days} days after the claim`;
  return "before the claim was made";
}
/**
 * A stored date (evidence_item.vintage_date, "YYYY-MM-DD") in the reader's
 * words. A date-only value is a calendar date, not an instant: it renders in UTC
 * so "2026-01-31" reads "31 Jan 2026" rather than sliding into February when
 * the New Zealand offset is applied to a midnight timestamp.
 */
export function readableDate(value: string): string {
  const dateOnly = value.length === 10;
  const parsed = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  return nzDate(parsed, dateOnly ? "UTC" : NZ_ZONE);
}
