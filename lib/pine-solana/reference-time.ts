/** Parse an explicit-zone ISO timestamp without Date.parse's calendar normalization. */
export function parseReferenceTimestamp(value: string): number {
  const match = typeof value === "string" && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) throw new Error("Reference timestamp must be ISO 8601 with an explicit timezone and at most millisecond precision");
  const [, y, m, d, hh, mm, ss, fraction, zone, sign, zh, zm] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const hour = Number(hh), minute = Number(mm), second = Number(ss);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const zoneHour = zone === "Z" ? 0 : Number(zh), zoneMinute = zone === "Z" ? 0 : Number(zm);
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59 || zoneHour > 23 || zoneMinute > 59) {
    throw new Error("Reference timestamp has an invalid calendar date, clock time, or timezone offset");
  }
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, Number((fraction ?? "").padEnd(3, "0")));
  const offset = (zoneHour * 60 + zoneMinute) * (sign === "-" ? -1 : 1);
  const timestamp = date.getTime() - offset * 60_000;
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error("Reference timestamp must be nonnegative safe integer milliseconds");
  return timestamp;
}
