// SDD-Focused: spec-driven development in Herdr. One mod, three views, chosen
// by the props a copy gets:
//   (none)                     the Specs panel                  panel.js
//   { file, root, on, space }  one spec rendered in a pane      viewer.js
//   { agentSettings: true }    the ⚙ Agents dialog              settings.js
// Data and agents live in lib/ (no UI there): specs.js, agents.js, util.js;
// shared widgets in lib/ui.js.
//
// Copyright 2026 José Gutiérrez. Licensed under the Apache License 2.0 (LICENSE).
import { View } from "gpui-kit";
import { props, theme } from "herdr";
import { Panel } from "./panel.js";
import { Viewer } from "./viewer.js";
import { Settings } from "./settings.js";

function viewFor(p) {
  if (p?.agentSettings) return new Settings();
  if (p?.file) return new Viewer();
  return new Panel();
}

export default class SddFocused extends View {
  init(_props, cx) {
    this.view = viewFor(props());
    this.view.init(cx);
  }

  render() {
    return this.view.render(theme());
  }
}
