const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

export function formatDateTime(d: Date | null | undefined): string {
  return d ? dateTime.format(d) : "—";
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}

export function fmtDistance(d: number | null | undefined): string {
  return d == null ? "—" : d.toFixed(3);
}
