/** Minimal Vercel-style req/res stubs shared by all handler tests. */
export function makeReq({ method = "POST", origin, ip, body, headers = {} } = {}) {
  const h = { ...headers };
  if (origin !== undefined) h.origin = origin;
  if (ip !== undefined) h["x-forwarded-for"] = ip;
  return { method, headers: h, body };
}

export function makeRes() {
  return {
    headers: {},
    statusCode: null,
    body: undefined,
    ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; this.ended = true; return this; },
    send(t) { this.body = t; this.ended = true; return this; },
    end() { this.ended = true; return this; },
  };
}
