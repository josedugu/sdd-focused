// Small pure helpers shared by every part of SDD-Focused.
import { spaces, panes, layout, run, exec, window } from "herdr";

export const MOD = "sdd-focused";
export const CLEAR = "#00000000";
// Specs, the config and an open spec are read again every 5 minutes; the
// refresh buttons read them at once.
export const REFRESH = 5 * 60 * 1000;

export const norm = (s) => (s ?? "").toString().trim().toLowerCase();
export const base = (p) => (p ?? "").replace(/\/+$/, "").split("/").pop();
export const parent = (p) => p.replace(/\/+$/, "").split("/").slice(0, -1).join("/");

export function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export const clock = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export const activeSpace = () => spaces().find((s) => s.active) ?? null;

// Where a space is now: its first terminal's live folder, else where it was made.
export function place(space) {
  const tabs = new Set((space.tabs ?? []).map((t) => t.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || space.folder;
}

// Changes when the active space, its folder or its machine changes.
export const contextKey = (s) => (s ? JSON.stringify([s.id, place(s), s.machine ?? null]) : null);

// Runs fn over items with at most `limit` at a time, keeping their order.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// A JSON value kept in this copy's localStorage.
export const stored = {
  get: (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; }
  },
  set: (key, value) => localStorage.setItem(key, JSON.stringify(value)),
};

// Hides the panel: the layout node named "panel" holding this mod (the 0oz and
// minimalistic layouts' right panel), else this mod's own block.
export function closePanel() {
  const path = (node, trail = []) => {
    if (!node) return null;
    const here = [...trail, node];
    if (node.content?.mod === MOD) return here;
    for (const child of node.children ?? []) {
      const found = path(child, here);
      if (found) return found;
    }
    return null;
  };
  const found = path(layout());
  if (!found) return;
  const target = [...found].reverse().find((n) => n.id === "panel") ?? found.at(-1);
  if (target?.id) run("layout.hide", { id: target.id });
}

// Opens a file with the system's default app.
export function openWithSystem(file) {
  const platform = window()?.platform;
  const [cmd, args] = platform === "windows" ? ["cmd", ["/c", "start", "", file]]
    : platform === "linux" ? ["xdg-open", [file]] : ["open", [file]];
  exec(cmd, args).catch(() => null);
}
