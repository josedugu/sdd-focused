// The building blocks every SDD-Focused view draws with. Theme colours only.
// statusMark and agentIcon follow the shipped agents list's marks
// (spinner, "Needs you", done dot, idle ring).
import { div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { CLEAR } from "./util.js";
import { PRIO } from "./specs.js";

export const ICON = {
  doc: "mods/workspace-chrome/file-text.svg",
  close: "mods/workspace-chrome/x.svg",
  back: "mods/workspace-chrome/chevron-left.svg",
  settings: "mods/workspace-chrome/settings.svg",
  search: "mods/workspace-chrome/search.svg",
  pin: "mods/workspace-chrome/pin.svg",
  unpin: "mods/workspace-chrome/pin-off.svg",
  spinner: "mods/workspace-chrome/spinner.svg",
};

// An agent's state: spinner, "Needs you", done dot, idle ring.
export function statusMark(t, status) {
  if (status === "working") return svg(ICON.spinner).size(12).mx(1).flex_none().text_color(t.working).spin(900);
  if (status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
  if (status === "done") return div().size(7).mx(3).flex_none().rounded(4).bg(t.done);
  return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
}

// A program's icon from Herdr's table: a one-colour glyph or a picture.
export function agentIcon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export function prioColor(t, p) {
  const r = PRIO[p] ?? 0;
  return r >= 3 ? t.blocked : r === 2 ? t.working : r === 1 ? t.ansi4 : t.dim;
}

export const dot = (color, size = 6) => div().size(size).flex_none().rounded(size / 2).bg(color);

// A square icon button (an svg path or a glyph).
export function iconButton(id, icon, tip, onClick, t) {
  return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(7)
    .text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
    .tooltip(tip).on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); cx.notify(); })
    .child(icon.startsWith("mods/") ? svg(icon).size(14) : div().text_size(13).child(icon));
}

// A labelled button: solid (primary) or outlined.
export function textButton(id, label, tip, primary, onClick, t) {
  return h_flex().id(id).h(28).px(10).gap(6).flex_none().items_center().justify_center().rounded(7)
    .cursor_pointer().text_size(12).font_medium()
    .when(primary, (el) => el.bg(t.solid).text_color(t.solid_foreground).hover((s) => s.bg(t.foreground)))
    .when(!primary, (el) => el.border(1).border_color(t.input).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)))
    .when(Boolean(tip), (el) => el.tooltip(tip))
    .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); cx.notify(); }).child(label);
}

// A small toggle pill: filters, agent and model choices.
export function chip(id, { label, on, tip, color, onClick }, t) {
  return h_flex().id(id).h(26).px(9).gap(6).flex_none().items_center().rounded(6).text_size(12)
    .border(1).border_color(on ? t.input : t.border).bg(on ? t.selected : CLEAR)
    .text_color(on ? t.foreground : t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
    .when(Boolean(tip), (el) => el.tooltip(tip))
    .on_click((_e, cx) => { onClick(cx); cx.notify(); })
    .when(Boolean(color), (el) => el.child(dot(color)))
    .child(label);
}

// A framed text field: its children are a gpui-base Input and, optionally, an icon.
export const field = (id, children, t) => h_flex().id(id).h(30).px(10).gap(7).items_center().rounded(8)
  .border(1).border_color(t.input).cursor_text().children(children);
