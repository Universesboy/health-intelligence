// Server-rendered SVG charts. Accuracy first: real values only, missing days stay empty (never
// drawn as zero), the personal baseline is a shaded band, and every chart has a text summary.
import { addDays } from "../lib/time";
import type { Point } from "../lib/insights";
import { esc } from "./html";

const W = 600;
const PAD = { l: 44, r: 12, t: 12, b: 26 };

export interface Band { low: number; high: number; label: string }

function days(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}
function niceRange(values: number[], extra: number[] = [], zero = false): [number, number] {
  const all = [...values, ...extra].filter(Number.isFinite);
  if (!all.length) return [0, 1];
  let lo = zero ? 0 : Math.min(...all); let hi = Math.max(...all);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12;
  return [zero ? 0 : lo - pad, hi + pad];
}
function fmt(v: number, digits: number) {
  return v.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}
function axis(h: number, lo: number, hi: number, digits: number, from: string, to: string, x: (d: string) => number, W = 600) {
  const ticks = [lo, (lo + hi) / 2, hi].map((v) => {
    const y = PAD.t + (1 - (v - lo) / (hi - lo)) * (h - PAD.t - PAD.b);
    return `<line class="grid-line" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text x="${PAD.l - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end">${fmt(v, digits)}</text>`;
  }).join("");
  const span = days(from, to);
  const labels = [from, addDays(from, Math.round(span / 2)), to].map((d, i) =>
    `<text x="${x(d).toFixed(1)}" y="${h - 6}" text-anchor="${i === 0 ? "start" : i === 2 ? "end" : "middle"}">${d.slice(5)}</text>`).join("");
  return ticks + labels;
}

export interface ChartSpec {
  points: Point[];
  from: string;
  to: string;
  color: string;
  label: string;
  unit: string;
  digits?: number;
  height?: number;
  band?: Band | null;
  target?: number | null;
  zero?: boolean;
}

/** Daily bars (sleep, steps, minutes). */
export function barChart(s: ChartSpec): string {
  const h = s.height ?? 190; const digits = s.digits ?? 0;
  const pts = s.points.filter((p) => p.date >= s.from && p.date <= s.to);
  const [lo, hi] = niceRange(pts.map((p) => p.value), [s.band?.high ?? NaN, s.target ?? NaN], s.zero ?? true);
  const n = days(s.from, s.to) + 1; const slot = (W - PAD.l - PAD.r) / n;
  const x = (d: string) => PAD.l + days(s.from, d) * slot + slot / 2;
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (h - PAD.t - PAD.b);
  const bw = Math.max(1.5, Math.min(14, slot * 0.68));
  const band = s.band ? `<rect x="${PAD.l}" width="${W - PAD.l - PAD.r}" y="${y(s.band.high).toFixed(1)}" height="${Math.max(1, y(s.band.low) - y(s.band.high)).toFixed(1)}" fill="var(--band)"/>` : "";
  const bars = pts.map((p) => `<rect x="${(x(p.date) - bw / 2).toFixed(1)}" y="${y(p.value).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, y(lo) - y(p.value)).toFixed(1)}" rx="${Math.min(3, bw / 2).toFixed(1)}" fill="${s.color}"><title>${p.date} ${fmt(p.value, digits)} ${esc(s.unit)}</title></rect>`).join("");
  const target = s.target != null ? `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(s.target).toFixed(1)}" y2="${y(s.target).toFixed(1)}" stroke="var(--color-brand)" stroke-dasharray="4 4"/>` : "";
  return frame(h, s, `${axis(h, lo, hi, digits, s.from, s.to, x)}${band}${bars}${target}`, pts.length);
}

/** Dots for each measurement plus a trailing 7-day mean line (weight, readiness). */
export function trendChart(s: ChartSpec & { smooth?: number }): string {
  const h = s.height ?? 190; const digits = s.digits ?? 1;
  const pts = s.points.filter((p) => p.date >= s.from && p.date <= s.to);
  const [lo, hi] = niceRange(pts.map((p) => p.value), [s.target ?? NaN, s.band?.low ?? NaN, s.band?.high ?? NaN], s.zero ?? false);
  const n = days(s.from, s.to) || 1;
  const x = (d: string) => PAD.l + (days(s.from, d) / n) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (h - PAD.t - PAD.b);
  const win = s.smooth ?? 7;
  const smooth = pts.map((p) => {
    const inWin = pts.filter((q) => q.date <= p.date && q.date > addDays(p.date, -win));
    return { date: p.date, value: inWin.reduce((a, q) => a + q.value, 0) / inWin.length, n: inWin.length };
  });
  // Break the line where measurements are more than 10 days apart.
  let path = ""; let prev: string | null = null;
  for (const p of smooth) {
    const cmd = prev && days(prev, p.date) <= 10 ? "L" : "M";
    path += `${cmd}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`; prev = p.date;
  }
  const band = s.band ? `<rect x="${PAD.l}" width="${W - PAD.l - PAD.r}" y="${y(s.band.high).toFixed(1)}" height="${Math.max(1, y(s.band.low) - y(s.band.high)).toFixed(1)}" fill="var(--band)"/>` : "";
  const dots = pts.map((p) => `<circle cx="${x(p.date).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3" fill="var(--color-surface)" stroke="${s.color}" stroke-width="1.6"><title>${p.date} ${fmt(p.value, digits)} ${esc(s.unit)}</title></circle>`).join("");
  const target = s.target != null ? `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(s.target).toFixed(1)}" y2="${y(s.target).toFixed(1)}" stroke="var(--color-brand)" stroke-dasharray="4 4"/><text x="${W - PAD.r}" y="${(y(s.target) - 5).toFixed(1)}" text-anchor="end">目标 ${fmt(s.target, digits)}</text>` : "";
  const line = pts.length > 1 ? `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>` : "";
  return frame(h, s, `${axis(h, lo, hi, digits, s.from, s.to, x)}${band}${target}${line}${dots}`, pts.length);
}

/** Stacked daily load (teaching + training) with the 7-day mean as a line. */
export function loadChart(rows: { date: string; coachingLoad: number | null; trainingLoad: number | null; acute7: number | null }[], from: string, to: string, height = 220, W = 1100): string {
  const pts = rows.filter((r) => r.date >= from && r.date <= to);
  const totals = pts.map((r) => (r.coachingLoad ?? 0) + (r.trainingLoad ?? 0));
  const [lo, hi] = niceRange(totals, pts.map((r) => r.acute7 ?? NaN), true);
  const n = days(from, to) + 1; const slot = (W - PAD.l - PAD.r) / n;
  const x = (d: string) => PAD.l + days(from, d) * slot + slot / 2;
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (height - PAD.t - PAD.b);
  const bw = Math.max(1.5, Math.min(18, slot * 0.6));
  let bars = ""; let path = ""; let prev = false;
  for (const r of pts) {
    const c = r.coachingLoad ?? 0; const t = r.trainingLoad ?? 0;
    if (c) bars += `<rect x="${(x(r.date) - bw / 2).toFixed(1)}" y="${y(c).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(0) - y(c)).toFixed(1)}" fill="var(--series-load)"><title>${r.date} 教学负荷 ${fmt(c, 0)}</title></rect>`;
    if (t) bars += `<rect x="${(x(r.date) - bw / 2).toFixed(1)}" y="${y(c + t).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(c) - y(c + t)).toFixed(1)}" fill="var(--series-recovery)"><title>${r.date} 训练负荷 ${fmt(t, 0)}</title></rect>`;
    if (r.coachingLoad === null || r.trainingLoad === null) bars += `<circle cx="${x(r.date).toFixed(1)}" cy="${(y(0) - 3).toFixed(1)}" r="3" fill="var(--color-text-muted)"><title>${r.date} 缺少强度</title></circle>`;
    if (r.acute7 != null) { path += `${prev ? "L" : "M"}${x(r.date).toFixed(1)},${y(r.acute7).toFixed(1)}`; prev = true; } else prev = false;
  }
  const line = path ? `<path d="${path}" fill="none" stroke="var(--color-brand)" stroke-width="2" stroke-linejoin="round"/>` : "";
  return `<svg class="chart wide" viewBox="0 0 ${W} ${height}" role="img" aria-label="每日负荷，${pts.length} 天">${axis(height, lo, hi, 0, from, to, x, W)}${bars}${line}</svg>`;
}

function frame(h: number, s: ChartSpec, inner: string, n: number) {
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(s.label)}，${n} 天有数据">${inner}</svg>`;
}

/** Tiny line for tiles. Gaps stay gaps. */
export function sparkline(points: Point[], from: string, to: string, color: string): string {
  const pts = points.filter((p) => p.date >= from && p.date <= to);
  if (pts.length < 2) return "";
  const w = 160; const h = 34; const n = days(from, to) || 1;
  const vals = pts.map((p) => p.value); const lo = Math.min(...vals); const hi = Math.max(...vals); const r = hi - lo || 1;
  let d = ""; let prev: string | null = null;
  for (const p of pts) {
    const xx = (days(from, p.date) / n) * w; const yy = 3 + (1 - (p.value - lo) / r) * (h - 6);
    d += `${prev && days(prev, p.date) <= 3 ? "L" : "M"}${xx.toFixed(1)},${yy.toFixed(1)}`; prev = p.date;
  }
  const last = pts[pts.length - 1]!;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/><circle cx="${((days(from, last.date) / n) * w).toFixed(1)}" cy="${(3 + (1 - (last.value - lo) / r) * (h - 6)).toFixed(1)}" r="2.5" fill="${color}"/></svg>`;
}

/** Completeness ring with depth (gradient stroke and soft drop shadow). */
export function ring(percent: number, label: string): string {
  const r = 52; const c = 2 * Math.PI * r; const p = Math.max(0, Math.min(100, percent));
  return `<div class="ring" role="img" aria-label="${esc(label)} ${p}%"><svg viewBox="0 0 128 128" aria-hidden="true">
<defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c8f169"/><stop offset="1" stop-color="#2f8f5b"/></linearGradient>
<radialGradient id="rf" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#eef0e6"/></radialGradient></defs>
<circle cx="64" cy="64" r="58" fill="url(#rf)" stroke="var(--color-border)"/>
<circle cx="64" cy="64" r="${r}" fill="none" stroke="var(--color-surface-muted)" stroke-width="10"/>
<circle cx="64" cy="64" r="${r}" fill="none" stroke="url(#rg)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${((p / 100) * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 64 64)"/></svg>
<div class="center"><b>${p}</b><small>${esc(label)}</small></div></div>`;
}
