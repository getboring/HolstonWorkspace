import { getAgentByName, routeAgentEmail, routeAgentRequest } from "agents";
import { createSecureReplyEmailResolver } from "agents/email";
import { agentNameFromEmail, verifyAccessJWT, type AuthUser } from "../auth";
import { assertSameOrigin } from "../core/csrf";
import { SkillStore } from "../skills/store";

export const DEFAULT_AGENT = "default";
export const AGENT_CLASS = "HolstonAgent";
export const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

function accessConfigured(env: Env): boolean {
  return Boolean(env.TEAM_DOMAIN && env.POLICY_AUD);
}

/**
 * Defense-in-depth behind Cloudflare Access: verify the JWT Access injects.
 * When Access is not configured (local dev), requests pass with no user.
 */
export async function authorize(
  request: Request,
  env: Env,
): Promise<{ user: AuthUser | null } | Response> {
  if (!accessConfigured(env)) return { user: null };
  const user = await verifyAccessJWT(request, env);
  if (!user) return new Response("Unauthorized", { status: 401 });
  return { user };
}

export function instanceForUser(user: AuthUser | null): string {
  return user ? agentNameFromEmail(user.email) : DEFAULT_AGENT;
}

export function ownerInstance(env: Env): string {
  return env.OWNER_EMAIL ? agentNameFromEmail(env.OWNER_EMAIL) : DEFAULT_AGENT;
}

function allowedEmailSenders(env: Env): Set<string> {
  const senders = new Set<string>();
  for (const entry of (env.ALLOWED_EMAIL_SENDERS ?? "").split(",")) {
    const email = entry.trim().toLowerCase();
    if (email) senders.add(email);
  }
  if (env.OWNER_EMAIL) senders.add(env.OWNER_EMAIL.trim().toLowerCase());
  return senders;
}

/** The Worker fetch handler: health, agent routing (guarded), setup, skills HTTP API. */
export async function handleFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return Response.json({
      status: "ok",
      agent: "holston-workspace",
      timestamp: new Date().toISOString(),
    });
  }

  // Every agent route (WebSocket chat, voice, HTTP RPC) requires the Access
  // JWT, and the URL's instance name must match the authenticated user's.
  const guardAgentRoute = async (
    req: Request,
    lobby: { name: string },
  ): Promise<Response | undefined> => {
    const auth = await authorize(req, env);
    if (auth instanceof Response) return auth;
    if (lobby.name !== instanceForUser(auth.user)) {
      return new Response("Forbidden", { status: 403 });
    }
    return undefined;
  };

  const agentResponse = await routeAgentRequest(request, env, {
    onBeforeConnect: guardAgentRoute,
    onBeforeRequest: guardAgentRoute,
  });
  if (agentResponse) return agentResponse;

  // Messenger webhooks are handled in the root Think agent's onRequest —
  // forward to the owner's instance (authenticity via the messenger's own
  // verifyWebhook).
  if (url.pathname.startsWith("/messengers/") && request.method === "POST") {
    const agent = await getAgentByName(env.HolstonAgent, ownerInstance(env));
    return agent.fetch(request);
  }

  if (request.method === "POST" && url.pathname === "/setup/telegram-webhook") {
    const auth = await authorize(request, env);
    if (auth instanceof Response) return auth;
    return setupTelegramWebhook(request, env);
  }

  if (request.method === "GET" && url.pathname === "/setup/info") {
    const auth = await authorize(request, env);
    if (auth instanceof Response) return auth;
    return Response.json({
      agentName: instanceForUser(auth.user),
      webhookPath: "/messengers/telegram/webhook",
      authenticated: !!auth.user,
      user: auth.user?.email ?? null,
    });
  }

  if (request.method === "GET" && url.pathname === "/api/skills") {
    const auth = await authorize(request, env);
    if (auth instanceof Response) return auth;
    const store = new SkillStore(env.SKILLS_BUCKET, env.SKILLS_INDEX, env.AI);
    const [approved, pending] = await Promise.all([
      store.list(),
      store.listPending(),
    ]);
    return Response.json({ skills: approved, pending });
  }

  const pendingAction = url.pathname.match(
    /^\/api\/skills\/pending\/([^/]+)\/(approve|reject)$/,
  );
  if (request.method === "POST" && pendingAction) {
    // Browser-driven mutation: block cross-origin (CSRF) before auth.
    const csrf = assertSameOrigin(request);
    if (csrf) return csrf;
    const auth = await authorize(request, env);
    if (auth instanceof Response) return auth;
    const name = decodeURIComponent(pendingAction[1] ?? "");
    if (!SKILL_NAME_PATTERN.test(name)) {
      return Response.json({ error: "Invalid skill name" }, { status: 400 });
    }
    const store = new SkillStore(env.SKILLS_BUCKET, env.SKILLS_INDEX, env.AI);
    if (pendingAction[2] === "approve") {
      const approved = await store.approvePending(name);
      if (!approved) {
        return Response.json(
          { error: `No pending skill "${name}"` },
          { status: 404 },
        );
      }
      return Response.json({ ok: true, skill: approved });
    }
    await store.rejectPending(name);
    return Response.json({ ok: true });
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    const auth = await authorize(request, env);
    if (auth instanceof Response) return auth;
    return env.ASSETS.fetch(request);
  }

  if (url.pathname.startsWith("/assets/") || url.pathname === "/sw.js") {
    return env.ASSETS.fetch(request);
  }

  return new Response("Not found", { status: 404 });
}

/** The Worker email handler: routes inbound mail to the per-sender agent. */
export async function handleEmail(
  message: ForwardableEmailMessage,
  env: Env,
): Promise<void> {
  await routeAgentEmail(message, env, {
    resolver: async (email, env) => {
      if (env.EMAIL_SIGNING_SECRET) {
        const secureResolver = createSecureReplyEmailResolver<Env>(
          env.EMAIL_SIGNING_SECRET,
          {
            onInvalidSignature: (
              rejected: ForwardableEmailMessage,
              reason: string,
            ) => {
              console.warn(
                `[holston] Email reply signature rejected from ${rejected.from}: ${reason}`,
              );
            },
          },
        );
        const replyRouting = await secureResolver(email, env);
        if (replyRouting) return replyRouting;
      }
      const from = email.from.trim().toLowerCase();
      if (!allowedEmailSenders(env).has(from)) return null;
      return { agentName: AGENT_CLASS, agentId: agentNameFromEmail(from) };
    },
    onNoRoute: (email) => {
      console.warn(
        `[holston] Rejecting email from unauthorized sender: ${email.from}`,
      );
      email.setReject("Sender not authorized");
    },
  });
}

async function setupTelegramWebhook(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return Response.json({ error: "TELEGRAM_BOT_TOKEN not set" }, { status: 400 });
  }
  const url = new URL(request.url);
  const webhookUrl = `${url.origin}/messengers/telegram/webhook`;
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`,
    {
      body: JSON.stringify({
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET_TOKEN,
        url: webhookUrl,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  const result = await response.json();
  return Response.json(
    { ok: response.ok, result, webhookUrl },
    { status: response.ok ? 200 : 502 },
  );
}
