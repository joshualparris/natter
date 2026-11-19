// Adapts Natter's (req, res) handlers to Netlify Functions (Request -> Response).
export async function run(handler, request) {
  const text = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
  let body;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  const req = { method: request.method, headers: Object.fromEntries(request.headers), body, url: request.url };
  return new Promise((resolve, reject) => {
    let code = 200;
    const headers = {};
    const res = {
      status(c) { code = c; return res; },
      setHeader(k, v) { headers[k] = v; return res; },
      json(o) { headers["content-type"] = "application/json; charset=utf-8"; resolve(new Response(JSON.stringify(o), { status: code, headers })); return res; },
      send(s) { resolve(new Response(s ?? null, { status: code, headers })); return res; },
      end(s) { resolve(new Response(s ?? null, { status: code, headers })); return res; },
    };
    Promise.resolve(handler(req, res)).then(() => resolve(new Response(null, { status: code === 200 ? 204 : code, headers })), reject);
  });
}
