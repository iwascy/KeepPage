const WHEN_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const RELATIVE_WHEN_FORMATTER = new Intl.RelativeTimeFormat("zh-CN", {
  numeric: "auto",
});

const RELATIVE_WHEN_UNITS = [
  { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: "week", ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: "day", ms: 24 * 60 * 60 * 1000 },
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
] as const;

export function formatWhen(input: string) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }
  return WHEN_FORMATTER.format(date);
}

export function formatRelativeWhen(input: string) {
  const target = new Date(input);
  const diffMs = target.getTime() - Date.now();
  if (Number.isNaN(diffMs)) {
    return formatWhen(input);
  }

  const absMs = Math.abs(diffMs);
  if (absMs < 60_000) {
    return "刚刚";
  }

  for (const { unit, ms } of RELATIVE_WHEN_UNITS) {
    if (absMs >= ms) {
      return RELATIVE_WHEN_FORMATTER.format(Math.round(diffMs / ms), unit);
    }
  }

  return formatWhen(input);
}

const COMPACT_RELATIVE_UNITS = [
  { ms: 365 * 24 * 60 * 60 * 1000, label: "年" },
  { ms: 30 * 24 * 60 * 60 * 1000, label: "个月" },
  { ms: 7 * 24 * 60 * 60 * 1000, label: "周" },
  { ms: 24 * 60 * 60 * 1000, label: "天" },
  { ms: 60 * 60 * 1000, label: "小时" },
  { ms: 60 * 1000, label: "分钟" },
] as const;

export function formatCompactRelativeWhen(input: string) {
  const target = new Date(input);
  const diffMs = target.getTime() - Date.now();
  if (Number.isNaN(diffMs)) {
    return formatWhen(input);
  }

  if (diffMs > 0) {
    return formatWhen(input);
  }

  const absMs = Math.abs(diffMs);
  if (absMs < 60_000) {
    return "刚刚";
  }

  for (const { ms, label } of COMPACT_RELATIVE_UNITS) {
    if (absMs >= ms) {
      return `${Math.floor(absMs / ms)} ${label}前`;
    }
  }

  return "刚刚";
}
