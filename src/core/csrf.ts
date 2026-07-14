/**
 * CSRF / same-origin check for cookie-authenticated requests.
 *
 * Returns a 403 Response if the origin doesn't match, null if OK.
 *
 * Extracted from getboring/holston-pulse/src/core/platform/csrf.ts
 */

export function assertSameOrigin(request: Request): Response | null {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return null;
  }

  const origin = request.headers.get("Origin");
  if (!origin) {
    return new Response(
      JSON.stringify({ error: { code: "forbidden", message: "Missing Origin header" } }),
      { status: 403, headers: { "content-type": "application/json" } },
    );
  }

  const url = new URL(request.url);
  const expected = `${url.protocol}//${url.host}`;

  if (origin !== expected) {
    return new Response(
      JSON.stringify({ error: { code: "forbidden", message: "Origin mismatch" } }),
      { status: 403, headers: { "content-type": "application/json" } },
    );
  }

  return null;
}
