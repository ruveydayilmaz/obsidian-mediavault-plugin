export function todayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isFutureDate(value: string): boolean {
  if (!value) return false;

  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnlyMatch) {
    return value > todayIsoDate();
  }

  const dateTimeMatch =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (dateTimeMatch) {
    const [, year, month, day, hour, minute, second] = dateTimeMatch;
    const parsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      second ? Number(second) : 0,
    );
    if (Number.isNaN(parsed.getTime())) return false;
    return parsed.getTime() > Date.now();
  }

  return false;
}
