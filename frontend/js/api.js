// Every call to the shop's API goes through req(), which adds the login token and the
// guest cart key, and turns error responses into ApiError with the server's message.

function cartKey() {
  let k = null;
  try { k = localStorage.getItem("cartKey"); } catch { /* storage blocked */ }
  if (!k) {
    k = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try { localStorage.setItem("cartKey", k); } catch { /* storage blocked */ }
  }
  return k;
}

export const auth = {
  get token() {
    try { return localStorage.getItem("token"); } catch { return null; }
  },
  set(token) {
    try { token ? localStorage.setItem("token", token) : localStorage.removeItem("token"); } catch { /* storage blocked */ }
  },
};

export class ApiError extends Error {
  constructor(status, message, field) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

async function req(path, init = {}) {
  const headers = { "X-Cart-Key": cartKey() };
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (init.body && !(init.body instanceof FormData)) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(`/api${path}`, { ...init, headers: { ...headers, ...init.headers } });
  } catch {
    throw new ApiError(0, "Can't reach the shop right now. Check your connection and try again.");
  }
  if (res.status === 204) return undefined;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && auth.token && !path.startsWith("/auth/login")) auth.set(null);
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Something went wrong. Try again.", data.field);
  return data;
}

const json = (method, body) => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)])).toString();

export const api = {
  // Account
  login: (email, password) => req("/auth/login", json("POST", { email, password })),
  register: (b) => req("/auth/register", json("POST", b)),
  me: () => req("/auth/me"),
  updateMe: (b) => req("/auth/me", json("PATCH", b)),
  changePassword: (current, next) => req("/auth/password", json("POST", { current, next })),
  mergeCart: () => req("/cart/merge", json("POST", { guestKey: cartKey() })),

  // Shop
  settings: () => req("/settings"),
  categories: () => req("/categories"),
  products: (f = {}) => req(`/products?${qs(f)}`),
  productFilters: () => req("/products/filters"),
  product: (slug) => req(`/products/${encodeURIComponent(slug)}`),
  related: (slug) => req(`/products/${encodeURIComponent(slug)}/related`),

  // Cart & orders
  cart: () => req("/cart"),
  addToCart: (items) => req("/cart/items", json("POST", { items })),
  setQty: (productId, qty) => req(`/cart/items/${productId}`, json("PATCH", { qty })),
  removeItem: (productId) => req(`/cart/items/${productId}`, json("DELETE")),
  placeOrder: (b) => req("/orders", json("POST", b)),
  myOrders: () => req("/orders/mine"),
  trackOrder: (orderNo, mobile) => req(`/orders/track?${qs({ orderNo, mobile })}`),
  uploadSlip: (orderNo, fd) => req(`/orders/${encodeURIComponent(orderNo)}/payment-slip`, { method: "POST", body: fd }),

  // Wishlist
  wishlist: () => req("/wishlist"),
  wishlistIds: () => req("/wishlist/ids"),
  addWish: (productId) => req(`/wishlist/${productId}`, json("POST")),
  removeWish: (productId) => req(`/wishlist/${productId}`, json("DELETE")),

  admin: {
    dashboard: () => req("/admin/dashboard"),

    products: (f = {}) => req(`/admin/products?${qs(f)}`),
    product: (id) => req(`/admin/products/${id}`),
    saveProduct: (fd, id) => req(id ? `/products/${id}` : "/products", { method: id ? "PUT" : "POST", body: fd }),
    hideProduct: (id) => req(`/products/${id}`, json("DELETE")),
    deleteImage: (productId, imageId) => req(`/products/${productId}/images/${imageId}`, json("DELETE")),
    orderImages: (productId, order) => req(`/products/${productId}/images/order`, json("PUT", { order })),

    saveCategory: (fd, id) => req(id ? `/categories/${id}` : "/categories", { method: id ? "PUT" : "POST", body: fd }),
    deleteCategory: (id) => req(`/categories/${id}`, json("DELETE")),

    orders: (f = {}) => req(`/admin/orders?${qs(f)}`),
    order: (id) => req(`/admin/orders/${id}`),
    setStatus: (id, status) => req(`/admin/orders/${id}/status`, json("PATCH", { status })),
    setPayment: (id, paymentStatus) => req(`/admin/orders/${id}/payment`, json("PATCH", { paymentStatus })),

    customers: (f = {}) => req(`/admin/customers?${qs(f)}`),
    customer: (id) => req(`/admin/customers/${id}`),

    offers: () => req("/admin/offers"),
    saveOffer: (b, id) => req(id ? `/admin/offers/${id}` : "/admin/offers", json(id ? "PUT" : "POST", b)),
    deleteOffer: (id) => req(`/admin/offers/${id}`, json("DELETE")),

    salesReport: (range) => req(`/admin/reports/sales?range=${range}`),
    ordersReport: () => req("/admin/reports/orders"),
    productsReport: () => req("/admin/reports/products"),
    reportPdf: async (q) => {
      const res = await fetch(`/api/admin/reports/pdf?${qs(q)}`, { headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : {} });
      if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).error ?? "Couldn't create the report. Try again.");
      return { blob: await res.blob(), name: /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "report.pdf" };
    },

    saveSettings: (b) => req("/settings", json("PUT", b)),
  },
};
