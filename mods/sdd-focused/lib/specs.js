// Finding a project's spec folders and reading its specs. No UI here.
//
// ~/.config/herdr-app/sdd-focused.json (written by the ✨ Detect agent, or by hand):
//   { "projects": { "/abs/repo": { "sources": [
//       { "dir": "docs/specs", "label": "API",
//         "folders": { "pending": "pending", "paused": "paused", "finished": "finished", "canceled": "canceled" } } ] } } }
// "folders" is optional: subfolders are recognised by name (English or Spanish).
// Without an entry, <repo>/docs/specs is tried. Files starting with "_" are templates.
import { exec, readTextFile, appHome } from "herdr";
import { norm, base, parent, place, mapLimit } from "./util.js";

export const CONFIG_NAME = "sdd-focused.json";
export const CONFIG = () => `${appHome()}/${CONFIG_NAME}`;
export const DEFAULT_DIR = "docs/specs";
const MAX_FILES = 400;
const READ_AT_ONCE = 16;

export const PRIO = { critical: 4, critica: 4, "crítica": 4, high: 3, alta: 3, medium: 2, media: 2, low: 1, baja: 1 };
export const STATUSES = [
  { id: "pending", label: "Pending", one: "Pending", names: ["pending", "todo", "pendientes", "pendiente"] },
  { id: "paused", label: "Paused", one: "Paused", names: ["paused", "on-hold", "onhold", "pausados", "pausado", "pospuestos"] },
  { id: "finished", label: "Finished", one: "Finished", names: ["finished", "done", "completed", "finalizados", "finalizado", "terminados"] },
  { id: "canceled", label: "Canceled", one: "Canceled", names: ["canceled", "cancelled", "cancelados", "cancelado"] },
];
export const statusOf = (id) => STATUSES.find((s) => s.id === id);
export const statusOfFolder = (folder) => STATUSES.find((s) => s.names.includes(norm(base(folder))))?.id ?? "pending";

// Frontmatter (key: value lines between ---), the body without it, and the title:
// "# Spec: X" wins over any earlier heading, else the first "# ", else the file name.
// A first heading saying it's on hold ("⏸️ Spec postponed") marks it paused.
export function parse(text, file) {
  const fm = {};
  let body = text ?? "";
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(body);
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
      if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
    }
    body = body.slice(m[0].length);
  }
  const heading = /^#\s+spec\s*:\s*(.+)$/im.exec(body) ?? /^#\s+(.+)$/m.exec(body);
  const title = (heading ? heading[1].replace(/^spec\s*:\s*/i, "") : file.replace(/\.md$/, "").replace(/[-_]+/g, " ")).trim();
  const first = /^#\s+(.+)$/m.exec(body)?.[1] ?? "";
  const onHold = /postponed|on hold|paused|pospuest|pausad/i;
  const paused = onHold.test(first) || onHold.test(fm.status ?? fm.estado ?? "");
  return { fm, body, title, paused };
}

// A spec as the list and the viewer show it. Frontmatter keys in English or Spanish.
export function toItem(path, root, source, status, text) {
  const { fm, body, title, paused } = parse(text, base(path));
  return {
    path, status, source, title, body, paused,
    rel: path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path,
    prio: norm(fm.priority ?? fm.prioridad),
    state: fm.status ?? fm.estado ?? "",
    module: fm.module ?? fm.modulo ?? "",
    created: fm.created ?? fm.fechaCreacion ?? "",
    closed: fm.closed ?? fm.fechaCierre ?? "",
  };
}

// "⏸ postponed · medium · DRAFT · billing"
export function metaLine(it) {
  return [
    it.paused && it.status === "pending" ? "⏸ postponed" : null,
    it.prio || null, it.state || null, it.module || null,
    it.status === "finished" && it.closed ? `closed ${it.closed}` : null,
  ].filter(Boolean).join(" · ");
}

// The repo the space is in (a worktree's top) and its main checkout.
async function resolveRoot(cwd, on) {
  let root = cwd, main = cwd;
  try {
    const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
    if (top.code === 0) root = main = top.stdout.trim();
    const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
    const dir = common.code === 0 ? common.stdout.trim() : "";
    if (dir.endsWith("/.git")) main = dir.slice(0, -5); // a worktree uses its main checkout's entry
  } catch {
    // Not a repo, or no git: the folder itself is the project.
  }
  return { root, main };
}

async function readConfig() {
  const text = await readTextFile(CONFIG()).catch(() => null);
  try { return { cfg: JSON.parse(text ?? "{}"), error: null }; } catch (e) { return { cfg: {}, error: String(e.message ?? e) }; }
}

async function lines(cmd, args, on) {
  const r = await exec(cmd, args, { on }).catch(() => null);
  return r && r.code === 0 ? r.stdout.split("\n").filter(Boolean) : null;
}

// Each source: its base folder and which subfolder holds each status.
async function findSources(wanted, root, on) {
  const found = await mapLimit(wanted, 4, async (s) => {
    let dir = s.dir.startsWith("/") ? s.dir : `${root}/${s.dir.replace(/^\.\//, "")}`;
    if (statusOf("pending").names.includes(norm(base(dir)))) dir = parent(dir); // an entry naming the pending folder itself
    const subs = (await lines("find", [dir, "-mindepth", "1", "-maxdepth", "1", "-type", "d"], on))?.map(base);
    if (!subs) return null;
    const folders = {};
    for (const st of STATUSES) {
      const named = s.folders?.[st.id];
      const hit = named && subs.includes(named) ? named : subs.find((d) => st.names.includes(norm(d)));
      if (hit) folders[st.id] = `${dir}/${hit}`;
    }
    return Object.keys(folders).length ? { label: s.label ?? null, dir, folders } : null;
  });
  return found.filter(Boolean);
}

// Every status's spec files (paths only, nothing read yet).
async function listFiles(sources, on) {
  const files = Object.fromEntries(STATUSES.map((st) => [st.id, []]));
  const jobs = sources.flatMap((src) => Object.entries(src.folders).map(([st, folder]) => ({ st, folder, source: src.label })));
  const found = await mapLimit(jobs, 4, (j) => lines("find", [j.folder, "-maxdepth", "1", "-type", "f", "-name", "*.md"], on));
  jobs.forEach((j, i) => {
    for (const f of found[i] ?? []) if (!base(f).startsWith("_")) files[j.st].push({ f, source: j.source });
  });
  return files;
}

async function readSpecs(list, root, status, on) {
  const items = await mapLimit(list.slice(0, MAX_FILES), READ_AT_ONCE, async ({ f, source }) => {
    const text = await readTextFile(f, { on }).catch(() => null);
    return text == null ? null : toItem(f, root, source, status, text);
  });
  return items.filter(Boolean);
}

// Everything the panel shows for a space: its spec folders, how many specs each
// status has, and the read specs of pending (the badge counts them) and of `tab`.
export async function loadProject(space, tab) {
  const on = space.machine ?? null, cwd = place(space);
  const { root, main } = await resolveRoot(cwd, on);
  const config = await readConfig();
  const projects = config.cfg.projects ?? {};
  const entry = projects[root] ?? projects[main] ?? projects[cwd] ?? null;
  const sources = await findSources(entry?.sources?.length ? entry.sources : [{ dir: DEFAULT_DIR, label: null }], root, on);
  const files = await listFiles(sources, on);
  const data = { pending: await readSpecs(files.pending, root, "pending", on) };
  if (tab !== "pending") data[tab] = await readSpecs(files[tab], root, tab, on);
  const counts = Object.fromEntries(STATUSES.map((st) => [st.id, files[st.id].length]));
  // Postponed pending specs count as paused.
  const postponed = data.pending.filter((i) => i.paused).length;
  counts.pending -= postponed;
  counts.paused += postponed;
  return { on, root, project: main, configured: Boolean(entry), configError: config.error, sources, data, counts };
}
