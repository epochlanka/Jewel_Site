// Tiny HTML templating: html`...` escapes every value it is given, so text from the
// server can never turn into markup. Values that are already HTML (from html`` or
// raw()) are inserted as they are, and arrays are joined.

export class Html {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

export const raw = (s) => new Html(String(s));

const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => entities[c]);

function part(v) {
  if (v == null || v === false || v === true) return "";
  if (v instanceof Html) return v.s;
  if (Array.isArray(v)) return v.map(part).join("");
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return new Html(out);
}

// Optional attribute helpers: attr("aria-current", cond && "page") → ` aria-current="page"` or "".
export const attr = (name, value) => (value == null || value === false ? "" : raw(value === true ? ` ${name}` : ` ${name}="${esc(value)}"`));

export function setHtml(el, content) {
  el.innerHTML = part(content);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Delegated events: on(view, "click", "[data-act=save]", (e, el) => ...)
export function on(root, type, selector, fn) {
  const handler = (e) => {
    const el = e.target.closest?.(selector);
    if (el && root.contains(el)) fn(e, el);
  };
  root.addEventListener(type, handler);
  return () => root.removeEventListener(type, handler);
}

export const formData = (form) => Object.fromEntries(new FormData(form));
