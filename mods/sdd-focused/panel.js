// The Specs panel: a project's specs by status, with filters, pins, "in progress"
// marks and the live state of the agents working on them.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, InputState } from "gpui-base";
import { run, panes, openOverlay, setShared } from "herdr";
import { MOD, CLEAR, REFRESH, norm, base, clock, duration, activeSpace, contextKey, stored, closePanel } from "./lib/util.js";
import { PRIO, STATUSES, statusOf, metaLine, loadProject, DEFAULT_DIR, CONFIG_NAME } from "./lib/specs.js";
import { links, launchSpec, detectFolders, agentSummary } from "./lib/agents.js";
import { ICON, statusMark, agentIcon, prioColor, dot, iconButton, textButton, chip, field } from "./lib/ui.js";

const byPrio = (a, b) => (PRIO[b.prio] ?? 0) - (PRIO[a.prio] ?? 0) || b.created.localeCompare(a.created) || a.title.localeCompare(b.title);
const byClosed = (a, b) => b.closed.localeCompare(a.closed) || b.created.localeCompare(a.created) || a.title.localeCompare(b.title);

export class Panel {
  init(cx) {
    this.pins = stored.get("pins", {}); // project -> [abs path]
    this.marked = stored.get("marked", {}); // project -> [abs path]
    this.since = stored.get("since", {}); // abs path -> { s, at }: when its agent's state last changed
    this.tab = stored.get("tab", "pending");
    this.project = null;
    this.state = "loading";
    this.filter = "";
    this.prio = "all";
    this.hovered = null;
    this.gen = 0;
    this.input = InputState.new({ placeholder: "Filter specs…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); cx.notify(); });
    this.reload(cx);
    // Switching spaces shows that project's specs: an in-memory comparison, files
    // are read only when the project actually changes.
    cx.timer.every(700, (cx) => { if (contextKey(activeSpace()) !== this.ctxKey) this.reload(cx); });
    cx.timer.every(REFRESH, (cx) => this.reload(cx));
  }

  // ---- State ----------------------------------------------------------------------

  reload(cx) {
    const gen = ++this.gen;
    const space = activeSpace();
    this.ctxKey = contextKey(space);
    cx.spawn(async (cx) => {
      if (!space) { this.state = "none"; cx.notify(); return; }
      const loaded = await loadProject(space, this.tab).catch(() => null);
      if (gen !== this.gen) return; // a newer reload started meanwhile
      Object.assign(this, loaded ?? { sources: [] }, { space, updatedAt: Date.now() });
      this.state = this.sources.length ? "ready" : "none";
      this.publish();
      cx.notify();
    });
  }

  // Another status: its files are read the first time it's shown.
  select(status, cx) {
    this.tab = status;
    this.prio = "all";
    stored.set("tab", status);
    if (!this.data?.[status]) this.reload(cx);
  }

  // For a tab bar that wants a Specs button with a count (the minimalistic
  // layout's does): "sdd.badge" = { space, n, pending: [paths] }.
  publish() {
    const pending = (this.data?.pending ?? []).filter((i) => !i.paused).map((i) => i.path);
    setShared("sdd.badge", { space: this.space?.id ?? null, n: pending.length, pending });
  }

  listOf(kind) { return this[kind][this.project] ?? []; }
  toggle(kind, path) {
    const now = this.listOf(kind);
    this[kind][this.project] = now.includes(path) ? now.filter((p) => p !== path) : [...now, path];
    stored.set(kind, this[kind]);
  }

  // When the agent on a spec last changed state (done and idle count as one).
  stamp(path, status) {
    const s = status === "done" ? "idle" : status;
    if (this.since[path]?.s !== s) {
      this.since[path] = { s, at: Date.now() };
      stored.set("since", this.since);
    }
    return this.since[path].at;
  }

  // The spec, rendered, in a pane right of the focused one; one viewer per tab.
  open(it) {
    const tabId = activeSpace()?.tabs?.find((t) => t.active)?.id;
    const old = panes().find((p) => p.mod === MOD && p.tab === tabId);
    if (old) run("pane.close", { pane: old.pane });
    run("pane.split", { direction: "right", mod: MOD, props: { file: it.path, root: this.root, on: this.on ?? null, space: this.space.id } });
  }

  // Pending without postponed ones; paused with them.
  shownItems() {
    const pending = this.data?.pending ?? [];
    if (this.tab === "pending") return pending.filter((i) => !i.paused);
    if (this.tab === "paused") return [...pending.filter((i) => i.paused), ...(this.data.paused ?? [])];
    return this.data?.[this.tab] ?? null;
  }

  detect(cx) { detectFolders(this.space.id, this.root, this.on, cx); }

  // ---- Drawing --------------------------------------------------------------------

  header(t) {
    return h_flex().h(42).flex_none().px(12).gap(6).items_center().border_b(1).border_color(t.border)
      .child(svg(ICON.doc).size(14).text_color(t.muted))
      .child(div().flex_none().font_medium().text_color(t.foreground).child("Specs"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(this.root ? `· ${base(this.project ?? this.root)}` : ""))
      .child(iconButton("specs-reload", "⟳", `Refresh now (refreshes by itself every 5 min${this.updatedAt ? ` · last: ${clock(this.updatedAt)}` : ""})`, (cx) => this.reload(cx), t))
      .child(textButton("specs-detect", "✨ Detect", `An agent (${agentSummary("detect")}) finds this project's spec folders and writes ${CONFIG_NAME}`, false, (cx) => this.detect(cx), t))
      .child(iconButton("specs-agents", ICON.settings, `Agents & models · ▶ ${agentSummary("work")} · ✨ ${agentSummary("detect")}`, () => openOverlay({ mod: MOD, kind: "dialog", width: 460, height: 560, props: { agentSettings: true } }), t))
      .child(iconButton("specs-close", ICON.close, "Close panel", () => closePanel(), t));
  }

  // Pending · Paused · Finished · Canceled, each with its count.
  statusTabs(t) {
    return h_flex().flex_none().p(2).gap(2).rounded(8).bg(t.popover).items_center()
      .children(STATUSES.map((st) => {
        const on = this.tab === st.id;
        return h_flex().id(`status-${st.id}`).flex_1().min_w(0).h(26).gap(4).items_center().justify_center().rounded(6)
          .text_size(11.5).cursor_pointer().tooltip(`${st.label} specs`)
          .when(on, (el) => el.bg(t.selected).border(1).border_color(t.input).text_color(t.foreground).font_medium())
          .when(!on, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)))
          .on_click((_e, cx) => { this.select(st.id, cx); cx.notify(); })
          .child(div().truncate().child(st.label))
          .child(div().flex_none().text_color(t.dim).child(String(this.counts?.[st.id] ?? 0)));
      }));
  }

  prioChips(all, t) {
    const prios = [...new Set(all.map((i) => i.prio).filter(Boolean))].sort((a, b) => (PRIO[b] ?? 0) - (PRIO[a] ?? 0));
    if (prios.length < 2) return null;
    const count = (p) => all.filter((i) => i.prio === p).length;
    return h_flex().gap(5).flex_wrap()
      .child(chip("prio-all", { label: `All ${all.length}`, on: this.prio === "all", tip: "Every priority", onClick: () => { this.prio = "all"; } }, t))
      .children(prios.map((p) => chip(`prio-${p}`, {
        label: `${p[0].toUpperCase()}${p.slice(1)} ${count(p)}`, on: this.prio === p, color: prioColor(t, p),
        tip: this.prio === p ? "Clear filter" : `Only ${p} priority`,
        onClick: () => { this.prio = this.prio === p ? "all" : p; },
      }, t)));
  }

  rowActions(it, link, t) {
    const pinned = this.listOf("pins").includes(it.path);
    const marked = this.listOf("marked").includes(it.path);
    return h_flex().flex_none().gap(2).items_center()
      .child(iconButton(`pin-${it.path}`, pinned ? ICON.unpin : ICON.pin, pinned ? "Unpin" : "Pin to top", () => this.toggle("pins", it.path), t))
      .when(it.status === "pending" && !link, (el) => el
        .child(iconButton(`mark-${it.path}`, marked ? "◼" : "◻", marked ? "Unmark in progress" : "Mark in progress", () => this.toggle("marked", it.path), t))
        .child(iconButton(`run-${it.path}`, "▶", `Work on it with an agent (${agentSummary("work")})`, (cx) => launchSpec(this.space.id, this.root, this.on, it, cx), t)));
  }

  agentBadge(it, link, hover, t) {
    const when = this.stamp(it.path, link.status);
    const pic = agentIcon(link.program, 13, t.foreground);
    return h_flex().flex_none().gap(6).items_center()
      .when(!hover, (el) => el.child(div().text_size(11).text_color(t.dim).child(duration(Date.now() - when))))
      .child(h_flex().id(`go-${it.path}`).gap(5).items_center().px(3).h(20).rounded(5).hover((s) => s.bg(t.input))
        .tooltip("Go to the agent")
        .on_click((_e, cx) => { cx.stop_propagation(); if (link.pane) run("pane.focus", { pane: link.pane }); })
        .when(Boolean(pic), (el) => el.child(pic))
        .child(statusMark(t, link.status)));
  }

  row(it, link, t) {
    const pinned = this.listOf("pins").includes(it.path);
    const working = Boolean(link) || this.listOf("marked").includes(it.path);
    const hover = this.hovered === it.path;
    const actionable = it.status === "pending" || it.status === "paused";
    return v_flex().id(`spec-${it.path}`).flex_none().px(10).py(7).gap(3).rounded(8).cursor_pointer()
      .border_l(2).border_color(pinned ? t.working : working ? t.done : CLEAR)
      .hover((s) => s.bg(t.hover)).tooltip("Open the spec in a pane")
      .on_hover((on, cx) => { if (on) this.hovered = it.path; else if (this.hovered === it.path) this.hovered = null; cx.notify(); })
      .on_click(() => this.open(it))
      .child(h_flex().gap(6).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(it.status === "canceled" ? t.muted : t.foreground).child(it.title))
        .when(hover && actionable, (el) => el.child(this.rowActions(it, link, t)))
        .when(Boolean(link), (el) => el.child(this.agentBadge(it, link, hover, t))))
      .child(h_flex().gap(6).items_center().text_size(11).text_color(t.dim)
        .child(dot(prioColor(t, it.prio)))
        .child(div().flex_1().min_w(0).truncate().child(metaLine(it) || it.rel)));
  }

  section(id, label, color, items, lk, t) {
    if (!items.length) return [];
    return [
      h_flex().id(id).h(26).flex_none().px(10).pt(6).gap(6).items_center().text_size(11).font_medium()
        .child(div().text_color(color).child(label))
        .child(div().text_color(t.dim).child(String(items.length))),
      ...items.map((i) => this.row(i, lk.get(i.path), t)),
    ];
  }

  // Pending: pinned, in progress, then the rest (by source when there are several).
  pendingRows(visible, lk, t) {
    const pins = this.listOf("pins"), marked = this.listOf("marked");
    const busy = (i) => lk.has(i.path) || marked.includes(i.path);
    const rest = visible.filter((i) => !pins.includes(i.path) && !busy(i)).sort(byPrio);
    const pending = this.sources.length > 1
      ? this.sources.flatMap((s, n) => this.section(`sec-src-${n}`, `PENDING · ${s.label ?? base(s.dir)}`, t.dim, rest.filter((i) => i.source === (s.label ?? null)), lk, t))
      : this.section("sec-pending", "PENDING", t.dim, rest, lk, t);
    return [
      ...this.section("sec-pinned", "📌 PINNED", t.working, visible.filter((i) => pins.includes(i.path)).sort(byPrio), lk, t),
      ...this.section("sec-working", "IN PROGRESS", t.done, visible.filter((i) => !pins.includes(i.path) && busy(i)).sort(byPrio), lk, t),
      ...pending,
    ];
  }

  otherRows(visible, lk, t) {
    const label = statusOf(this.tab).label.toUpperCase();
    if (this.tab !== "paused") return this.section("sec-status", label, t.dim, visible.sort(byClosed), lk, t);
    const pins = this.listOf("pins");
    const sorted = visible.sort(byPrio);
    return [
      ...this.section("sec-pinned", "📌 PINNED", t.working, sorted.filter((i) => pins.includes(i.path)), lk, t),
      ...this.section("sec-status", label, t.dim, sorted.filter((i) => !pins.includes(i.path)), lk, t),
    ];
  }

  empty(t) {
    const loading = this.state === "loading";
    return v_flex().flex_1().items_center().justify_center().gap(10).p(24).text_size(12.5).text_color(t.muted)
      .child(div().text_color(t.foreground).font_medium().child(loading ? "Loading specs…" : "No specs set up"))
      .when(!loading, (el) => el
        .child(div().text_center().child(this.configured ? "The folders set up for this project don't exist." : `No spec folders for this project, nor ${DEFAULT_DIR}.`))
        .when(Boolean(this.configError), (el) => el.child(div().text_color(t.blocked).text_center().child(`${CONFIG_NAME} isn't valid: ${this.configError}`)))
        .child(textButton("specs-setup", "✨ Detect with an agent", `${agentSummary("detect")} finds the spec folders and writes ${CONFIG_NAME}`, true, (cx) => this.detect(cx), t))
        .child(textButton("specs-retry", "Look again", null, false, (cx) => this.reload(cx), t)));
  }

  render(t) {
    const root = v_flex().size_full().min_h(0).bg(t.background).text_size(13).child(this.header(t));
    if (this.state !== "ready") return root.child(this.empty(t));
    const lk = links();
    const all = this.shownItems();
    const q = norm(this.filter);
    const visible = (all ?? []).filter((i) => (this.prio === "all" || i.prio === this.prio)
      && (!q || norm(`${i.title} ${i.rel} ${i.module} ${i.state}`).includes(q)));
    const rows = this.tab === "pending" ? this.pendingRows(visible, lk, t) : this.otherRows(visible, lk, t);
    const note = all == null ? "Loading…" : !visible.length ? (all.length ? "No spec matches the filter." : "No specs in this status.") : null;
    return root
      .child(v_flex().flex_none().px(10).pt(10).pb(6).gap(8)
        .child(this.statusTabs(t))
        .child(field("specs-filter", [
          svg(ICON.search).size(13).text_color(t.dim),
          Input.new(this.input).flex_1().h_full().text_size(12.5).text_color(t.foreground),
        ], t))
        .when(Boolean(all), (el) => { const c = this.prioChips(all, t); return c ? el.child(c) : el; }))
      .child(v_flex().id("specs-list").flex_1().min_h(0).px(6).pb(12).overflow_y_scrollbar()
        .children(rows)
        .when(Boolean(note), (el) => el.child(div().p(16).text_color(t.dim).text_size(12.5).child(note))));
  }
}
