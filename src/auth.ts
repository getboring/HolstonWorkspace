import { jwtVerify, createRemoteJWKSet } from "jose";

export interface AuthUser {
  email: string;
  name: string;
  sub: string;
}

const JWKS_CACHE = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(teamDomain: string) {
  let jwks = JWKS_CACHE.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    JWKS_CACHE.set(teamDomain, jwks);
  }
  return jwks;
}

export async function verifyAccessJWT(
  request: Request,
  env: Env,
): Promise<AuthUser | null> {
  if (!env.TEAM_DOMAIN || !env.POLICY_AUD) {
    return null;
  }

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) {
    return null;
  }

  try {
    const jwks = getJwks(env.TEAM_DOMAIN);
    const { payload } = await jwtVerify(token, jwks, {
      issuer: env.TEAM_DOMAIN,
      audience: env.POLICY_AUD,
    });

    const email = payload.email as string | undefined;
    const name = (payload.name as string | undefined) ?? email ?? "User";
    const sub = (payload.sub as string | undefined) ?? email ?? "unknown";

    if (!email) {
      return null;
    }

    return { email, name, sub };
  } catch (err) {
    // Fail closed, but log so a JWKS fetch outage is distinguishable from an
    // actually-invalid token (both otherwise surface as a blanket 401).
    console.warn("[holston] Access JWT verification failed:", err);
    return null;
  }
}

export function agentNameFromEmail(email: string): string {
  return email
    .toLowerCase()
    .replace(/[^a-z0-9@.-]/g, "-")
    .replace(/[@.]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}