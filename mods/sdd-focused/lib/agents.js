// Starting agents on specs, and following the ones started. No UI here.
//
// Two jobs, each with its agent, model and autonomous mode (⚙ Agents), kept in
// shared state "sdd.agents" so the panel, viewers and the dialog agree:
//   work   ▶ implement a spec
//   detect ✨ find the spec folders and write the config
// An agent started on a spec gets the terminal label spec=<abs path>.
import { agents, terminals, run, hc, knownAgents, notify, shared, setShared } from "herdr";
import { base } from "./util.js";
import { CONFIG } from "./specs.js";

// How each CLI takes a model and its autonomous mode. `prompt`: it takes the
// first message as an argument (else Herdr types it in as the task).
const PROFILES = {
  claude: { label: "Claude Code", models: ["opus", "sonnet", "haiku", "fable"], model: (m) => ["--model", m], auto: ["--dangerously-skip-permissions"], prompt: true },
  codex: { label: "Codex", models: [], model: (m) => ["-m", m], auto: ["--dangerously-bypass-approvals-and-sandbox"], prompt: true },
  gemini: { label: "Gemini", models: [], model: (m) => ["--model", m], auto: ["--yolo"], prompt: false },
  cursor: { label: "Cursor", models: [], model: (m) => ["--model", m], auto: ["--force"], prompt: false },
  opencode: { label: "OpenCode", models: [], model: (m) => ["--model", m], auto: [], prompt: false },
};
const ALIASES = { "cursor-agent": "cursor", agent: "cursor" };

export const JOBS = {
  work: { label: "▶ Work on a spec", hint: "Implements the spec. Development work: use a capable model." },
  detect: { label: "✨ Detect folders", hint: "Finds the spec folders and writes the config. A simple task: a fast model is enough." },
};
const DEFAULTS = { work: { agent: "claude", model: "", auto: true }, detect: { agent: "claude", model: "haiku", auto: true } };

// The profile key of a knownAgents() entry, by its key or the program it runs.
export const profileKey = (a) => [a?.key, base(a?.run?.[0] ?? "")].map((k) => ALIASES[k] ?? k).find((k) => PROFILES[k]) ?? null;
export const profileOf = (a) => PROFILES[profileKey(a)] ?? { label: a?.name ?? "", models: [], model: (m) => ["--model", m], auto: [], prompt: false };
const matches = (a, name) => a.key === name || profileKey(a) === name || base(a.run?.[0] ?? "") === name;

export function agentPrefs() {
  const s = shared("sdd.agents") ?? {};
  return { work: { ...DEFAULTS.work, ...s.work }, detect: { ...DEFAULTS.detect, ...s.detect } };
}
export const setAgentPref = (job, patch) => setShared("sdd.agents", { ...agentPrefs(), [job]: { ...agentPrefs()[job], ...patch } });
export const findAgent = (list, job) => (list ?? []).find((a) => matches(a, agentPrefs()[job].agent)) ?? null;

export function agentSummary(job) {
  const p = agentPrefs()[job];
  return `${PROFILES[p.agent]?.label ?? p.agent}${p.model ? ` · ${p.model}` : ""}`;
}

// The command line a job runs (without the prompt).
export function commandFor(job, agent) {
  const pref = agentPrefs()[job];
  const prof = profileOf(agent);
  return [...(agent?.run ?? [pref.agent]), ...(pref.model ? prof.model(pref.model) : []), ...(pref.auto ? prof.auto : [])];
}

// Spec path -> the live agent started for it.
export function links() {
  const byAddress = new Map(agents().map((a) => [a.address, a]));
  const out = new Map();
  for (const term of terminals()) {
    const spec = term.labels?.spec;
    if (!spec || term.state !== "live") continue;
    const a = byAddress.get(term.address);
    out.set(spec, { address: term.address, status: a?.status ?? "idle", pane: a?.pane ?? null, program: a?.program ?? term.program });
  }
  return out;
}

// Labels the terminal a launch made: the new one whose command names the spec,
// else (agents that get the prompt as a task) the newest new one in that space.
function tagNew(before, spaceId, spec, cx, tries = 0) {
  cx.timer.after(400, (cx) => {
    const fresh = terminals().filter((x) => !before.has(x.address));
    const term = fresh.find((x) => (x.argv ?? []).join(" ").includes(spec.rel))
      ?? fresh.filter((x) => x.labels?.["herdr.space"] === spaceId).at(-1);
    if (term) cx.spawn(async (cx) => { await hc(["label", term.address, `spec=${spec.path}`]).catch(() => null); cx.notify(); });
    else if (tries < 25) tagNew(before, spaceId, spec, cx, tries + 1);
  });
}

// Starts the job's agent in a new tab, after checking it is installed: a missing
// agent gives a notice instead of a tab with "command not found".
export function startAgent(job, { spaceId, folder, on, name, prompt, spec }, cx) {
  cx.spawn(async (cx) => {
    const list = await knownAgents({ on: on ?? null }).catch(() => null);
    const agent = findAgent(list, job);
    if (list && !agent?.installed) {
      notify({ title: "SDD-Focused: agent not available", body: `${agent?.name ?? agentPrefs()[job].agent} isn't installed on this machine. Pick another in ⚙ Agents of the Specs panel.`, level: "warning", timeout: 8000 });
      return;
    }
    const prof = profileOf(agent);
    const argv = commandFor(job, agent);
    const before = new Set(terminals().map((t) => t.address));
    // tab.new runs agents inside the interactive shell, which stays open after it exits.
    run("tab.new", { name, space: spaceId, folder, argv: prof.prompt ? [...argv, prompt] : argv, ...(prof.prompt ? {} : { task: prompt }) });
    if (spec) tagNew(before, spaceId, spec, cx);
  });
}

export function launchSpec(spaceId, root, on, it, cx) {
  startAgent("work", {
    spaceId, folder: root, on, name: it.title.slice(0, 40), spec: it,
    prompt: `Work on the spec ${it.rel}. Read it fully and follow it according to the project's spec workflow (check CLAUDE.md or AGENTS.md if present).`,
  }, cx);
}

export function detectFolders(spaceId, root, on, cx) {
  const prompt = [
    `Set up the Herdr Specs panel for the project at ${root}.`,
    "1) In that repository, find the base spec folders (for example docs/specs; there may be several, for example in subprojects) and, inside each, the subfolders by status: pending, paused, finished and canceled (any language). Ignore node_modules, .next, dist, build and .git.",
    `2) Update the file ${CONFIG()} (create it if missing) with this JSON shape: {"projects": {"<absolute repo path>": {"sources": [{"dir": "<base spec folder, relative to the repo>", "label": "<short name>", "folders": {"pending": "<subfolder>", "paused": "<subfolder>", "finished": "<subfolder>", "canceled": "<subfolder>"}}]}}}. Include in "folders" only the statuses that exist. Use exactly "${root}" as the key and replace any entry it already has. Keep other projects' entries untouched.`,
    "3) Edit only that file; change nothing in the repository. Validate the JSON with jq and show the result. Then ask the user to press ⟳ in the Specs panel.",
  ].join(" ");
  startAgent("detect", { spaceId, folder: root, on, name: "Detect specs", prompt }, cx);
}
