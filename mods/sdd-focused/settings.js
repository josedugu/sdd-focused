// ⚙ Agents: which agent and model each job uses. A dialog: props { agentSettings: true }.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, InputState } from "gpui-base";
import { knownAgents, props, closeOverlay } from "herdr";
import { CLEAR, activeSpace } from "./lib/util.js";
import { JOBS, agentPrefs, setAgentPref, profileKey, profileOf, findAgent, commandFor } from "./lib/agents.js";
import { ICON, agentIcon, iconButton, chip, field } from "./lib/ui.js";

export class Settings {
  init(cx) {
    this.known = null; // knownAgents() of the active space's machine
    this.models = {}; // job -> the free-text model input
    for (const job of Object.keys(JOBS)) {
      const input = InputState.new({ placeholder: "Other model (exact id)…" });
      input.set_value(agentPrefs()[job].model ?? "");
      input.on("change", (_e, cx) => { setAgentPref(job, { model: input.value().trim() }); cx.notify(); });
      this.models[job] = input;
    }
    cx.spawn(async (cx) => {
      this.known = await knownAgents({ on: activeSpace()?.machine ?? null }).catch(() => []);
      cx.notify();
    });
  }

  setModel(job, model) {
    setAgentPref(job, { model });
    this.models[job].set_value(model);
  }

  agentChoices(job, t) {
    const pref = agentPrefs()[job];
    if (this.known == null) return div().text_size(12).text_color(t.dim).child("Looking for installed agents…");
    return h_flex().gap(5).flex_wrap().children(this.known.filter((a) => a.installed).map((a) => {
      const key = profileKey(a) ?? a.key;
      const on = key === pref.agent || a.key === pref.agent;
      const pic = agentIcon(a, 13, t.foreground);
      return chip(`agent-${job}-${a.key}`, {
        label: h_flex().gap(6).items_center().when(Boolean(pic), (el) => el.child(pic)).child(a.name),
        on, tip: `Use ${a.name} (${a.run.join(" ")})`,
        onClick: () => { if (!on) { setAgentPref(job, { agent: key }); this.setModel(job, ""); } },
      }, t);
    }));
  }

  modelChoices(job, prof, t) {
    const model = agentPrefs()[job].model;
    return h_flex().gap(5).flex_wrap()
      .child(chip(`model-${job}-default`, { label: "Default", on: !model, tip: "No --model: the agent's own default", onClick: () => this.setModel(job, "") }, t))
      .children(prof.models.map((m) => chip(`model-${job}-${m}`, { label: m, on: model === m, tip: `--model ${m}`, onClick: () => this.setModel(job, m) }, t)));
  }

  autonomy(job, prof, t) {
    const on = agentPrefs()[job].auto && prof.auto.length > 0;
    return h_flex().id(`auto-${job}`).gap(8).items_center().cursor_pointer()
      .when(prof.auto.length > 0, (el) => el.tooltip("Don't ask permission for each action")
        .on_click((_e, cx) => { setAgentPref(job, { auto: !agentPrefs()[job].auto }); cx.notify(); }))
      .child(div().size(16).flex_none().rounded(4).border(1.5).border_color(on ? t.foreground : t.input)
        .bg(on ? t.foreground : CLEAR).text_color(t.background).text_size(11).flex().items_center().justify_center().child(on ? "✓" : ""))
      .child(div().text_size(12).text_color(prof.auto.length ? t.foreground : t.dim)
        .child(prof.auto.length ? `Autonomous mode (${prof.auto.join(" ")})` : "No known autonomous mode for this agent"));
  }

  job(job, t) {
    const pref = agentPrefs()[job];
    const current = findAgent(this.known, job);
    const prof = profileOf(current ?? { key: pref.agent });
    const missing = this.known && !current?.installed;
    const label = (text) => div().text_size(11).text_color(t.dim).child(text);
    return v_flex().gap(8).p(12).rounded(10).border(1).border_color(t.border).bg(t.surface)
      .child(v_flex().gap(2)
        .child(div().font_medium().text_color(t.foreground).child(JOBS[job].label))
        .child(div().text_size(11.5).text_color(t.dim).child(JOBS[job].hint)))
      .child(label("Agent"))
      .child(this.agentChoices(job, t))
      .when(Boolean(missing), (el) => el.child(div().text_size(11.5).text_color(t.blocked)
        .child(`${pref.agent} isn't installed on this machine: pick another, or ▶/✨ will only show a notice.`)))
      .child(label("Model"))
      .child(this.modelChoices(job, prof, t))
      .child(field(`model-input-${job}`, [Input.new(this.models[job]).flex_1().h_full().text_size(12).text_color(t.foreground)], t))
      .child(this.autonomy(job, prof, t))
      .child(div().px(8).py(6).rounded(6).bg(t.background).border(1).border_color(t.border)
        .text_size(11).text_color(t.muted).font_family("JetBrains Mono")
        .child(`$ ${commandFor(job, current).join(" ")} "…"`));
  }

  render(t) {
    return v_flex().size_full().min_h(0).bg(t.popover).text_size(13)
      .child(h_flex().h(46).flex_none().px(16).gap(8).items_center().border_b(1).border_color(t.border)
        .child(svg(ICON.settings).size(15).text_color(t.muted))
        .child(div().flex_1().font_semibold().text_color(t.foreground).child("Spec agents"))
        .child(iconButton("agents-close", ICON.close, "Close", () => closeOverlay(props().overlay), t)))
      .child(v_flex().id("agents-body").flex_1().min_h(0).overflow_y_scrollbar().p(14).gap(12)
        .children(Object.keys(JOBS).map((job) => this.job(job, t)))
        .child(div().text_size(11).text_color(t.dim)
          .child("Saved at once; applies to the panel and open specs. Only agents installed on this machine are listed.")));
  }
}
