// A spec rendered in its own pane: props { file, root, on, space }.
import { div } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { run, props, readTextFile } from "herdr";
import { REFRESH, base, parent, clock, openWithSystem } from "./lib/util.js";
import { statusOf, statusOfFolder, toItem, metaLine } from "./lib/specs.js";
import { links, launchSpec, agentSummary } from "./lib/agents.js";
import { statusMark, prioColor, dot, textButton } from "./lib/ui.js";

export class Viewer {
  init(cx) {
    const p = props();
    this.file = p.file;
    this.root = p.root ?? parent(p.file);
    this.status = statusOfFolder(parent(p.file)); // its folder: pending/, finished/, ...
    this.item = null; // parsed once per read, not per frame
    this.missing = false;
    this.load(cx);
    cx.timer.every(REFRESH, (cx) => this.load(cx));
  }

  load(cx) {
    cx.spawn(async (cx) => {
      const text = await readTextFile(this.file, { on: props().on ?? null }).catch(() => null);
      this.missing = text == null;
      if (text != null) this.item = toItem(this.file, this.root, null, this.status, text);
      this.loadedAt = Date.now();
      cx.notify();
    });
  }

  header(it, t) {
    const label = this.status === "pending" && it?.paused ? "Paused" : statusOf(this.status).one;
    return v_flex().flex_none().px(16).pt(12).pb(10).gap(4).border_b(1).border_color(t.border)
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().text_color(t.foreground).child(it?.title ?? base(this.file)))
        .child(div().flex_none().px(6).h(18).rounded(5).border(1).border_color(t.input).text_size(10.5).text_color(t.muted).flex().items_center().child(label)))
      .when(Boolean(it), (el) => el.child(h_flex().gap(6).items_center().text_size(11.5).text_color(t.dim)
        .child(dot(prioColor(t, it.prio)))
        .child(div().flex_none().child(metaLine(it)))
        .child(div().flex_1().min_w(0).truncate().text_right().child(it.rel))));
  }

  footer(it, t) {
    const p = props();
    const link = links().get(this.file);
    const canWork = !link && this.status === "pending" && !this.missing && it;
    return h_flex().flex_none().px(12).py(9).gap(8).items_center().border_t(1).border_color(t.border)
      .when(Boolean(link), (el) => el
        .child(textButton("spec-go", "Go to agent", "Focus the agent working on this spec", true, () => { if (link.pane) run("pane.focus", { pane: link.pane }); }, t))
        .child(statusMark(t, link.status)))
      .when(Boolean(canWork), (el) => el
        .child(textButton("spec-run", "▶ Work on it", `Opens a tab with ${agentSummary("work")} working on this spec`, true, (cx) => launchSpec(p.space, this.root, p.on ?? null, it, cx), t)))
      .child(div().flex_1())
      .when(Boolean(this.loadedAt), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`Read ${clock(this.loadedAt)}`)))
      .child(textButton("spec-refresh", "⟳ Refresh", "Read the spec again now (refreshes by itself every 5 min)", false, (cx) => this.load(cx), t))
      .when(!p.on, (el) => el.child(textButton("spec-editor", "Open in editor", "Opens the .md with the system's default app", false, () => openWithSystem(this.file), t)));
  }

  render(t) {
    const it = this.item;
    return v_flex().size_full().min_h(0).bg(t.background).text_size(13)
      .child(this.header(it, t))
      .when(this.missing, (el) => el.child(div().px(16).py(8).text_size(12).text_color(t.blocked).bg(t.blocked + "14")
        .child(it ? "The file isn't here anymore (moved to another folder?). Showing the last version read." : "The file couldn't be read.")))
      .child(div().id("spec-body").flex_1().min_h(0).overflow_y_scrollbar().px(18).py(14)
        .child(it ? TextView.markdown(`md-${this.file}`, it.body).w_full().text_size(13).text_color(t.foreground)
          : div().text_color(t.dim).child(this.missing ? "" : "Loading…")))
      .child(this.footer(it, t));
  }
}
