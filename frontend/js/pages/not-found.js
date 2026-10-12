import { html, setHtml } from "../html.js";
import { icon } from "../icons.js";

export default function notFound(view) {
  setHtml(view, html`<div class="not-found">
    <span class="not-found-art">${icon("diamond", 72)}</span>
    <h1>Page not found</h1>
    <p>The page you're looking for doesn't exist or has moved.</p>
    <div class="card-actions"><a href="/" class="btn btn-primary">Go to home</a><a href="/shop" class="btn btn-quiet">Browse jewellery</a></div>
  </div>`);
}
