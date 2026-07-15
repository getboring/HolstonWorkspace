/**
 * Bearer-token gate for the MCP server endpoint. Pure and dependency-free so it
 * can be unit-tested without the Cloudflare runtime imports that `mcp.ts` pulls
 * in. Length-checked, difference-accumulating comparison — tokens are
 * high-entropy secrets, so this is about not short-circuiting on the first
 * differing byte, not defeating a timing oracle over the network.
 */
export function bearerOk(authHeader: string | null, key: string | undefined): boolean {
  if (!key) return false; // Closed unless a key is configured — no key, no server.
  const header = authHeader ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (token.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) {
    diff |= token.charCodeAt(i) ^ key.charCodeAt(i);
  }
  return diff === 0;
}
