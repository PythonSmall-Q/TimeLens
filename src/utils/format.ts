/**
 * Format seconds into a human-readable duration string.
 * e.g. 3720 → "1h 2m"  |  45 → "45s"
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Format seconds as "Xh Xm" (always showing minutes). */
export function formatDurationVerbose(seconds: number, t: (k: string) => string): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}${t("hours")}`);
  parts.push(`${m}${t("minutes")}`);
  return parts.join(" ");
}

/** Returns today's date as YYYY-MM-DD (local timezone) */
export function todayString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Returns the date N days ago as YYYY-MM-DD (local timezone) */
export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Clamp a number between min and max */
export function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

/** Derive a deterministic accent color from app name */
const ACCENT_COLORS = [
  "#6c8ebf", "#8b6cbf", "#4ea5a0", "#4caf7d",
  "#e09050", "#6b9ed4", "#a06cbf", "#4e8abf",
];
export function appColor(appName: string): string {
  let hash = 0;
  for (let i = 0; i < appName.length; i++) {
    hash = appName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return ACCENT_COLORS[Math.abs(hash) % ACCENT_COLORS.length];
}

/** Pad single digit with leading zero */
export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
