/**
 * Holston as an MCP *server*. We already consume MCP servers (the client side);
 * this publishes Holston's own capabilities as tools so other agents — Claude,
 * a CLI, another Boring product — can call the owner's reminders, memory,
 * skills, receipts, and health over the Model Context Protocol.
 *
 * The tools operate on the *owner's existing agent instance* (via a DO stub),
 * not a separate MCP-only Durable Object, so an external caller sees the same
 * reminders and memory the owner sees in the dashboard.
 *
 * Mounted at `/mcp` by the Worker fetch handler, gated by a bearer token
 * (`MCP_ACCESS_KEY`). Writes stay behind the same idempotency/receipt path the
 * dashboard uses — the DO callables ARE the write path.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "agents/mcp";
import { getAgentByName } from "agents";
import { z } from "zod";
import { bearerOk } from "./lib/bearer";
import { ownerInstance } from "./lib/worker";

/** JSON text-content result, the shape MCP tool callbacks return. */
function text(value: unknown) {
  const body = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text: body }] };
}

/**
 * Build the Holston MCP server. Every tool resolves the owner's agent instance
 * fresh (stubs are cheap) and calls its existing public/@callable methods.
 */
export function buildHolstonMcpServer(env: Env): McpServer {
  const server = new McpServer(
    { name: "holston-workspace", version: "0.6.0" },
    {
      instructions:
        "Holston Workspace — the owner's personal Cloudflare agent. Use these " +
        "tools to read and manage their reminders, durable memory, saved " +
        "skills, action receipts, and system health.",
    },
  );

  const owner = () => getAgentByName(env.HolstonAgent, ownerInstance(env));

  // ── Reminders ──────────────────────────────────────────────────────────
  server.registerTool(
    "list_reminders",
    {
      title: "List reminders",
      description: "List the owner's scheduled reminders and recurring tasks.",
      inputSchema: {},
    },
    async () => text(await (await owner()).listReminders()),
  );

  server.registerTool(
    "create_reminder",
    {
      title: "Create reminder",
      description:
        "Schedule a reminder from natural language, e.g. 'every weekday at 9am' " +
        "or 'tomorrow at 3pm review the deploy'. Resolves in the owner's timezone.",
      inputSchema: {
        request: z.string().min(3).max(500).describe("Natural-language reminder"),
      },
    },
    async ({ request }) => text(await (await owner()).createReminder(request)),
  );

  server.registerTool(
    "cancel_reminder",
    {
      title: "Cancel reminder",
      description: "Cancel a reminder by its id (from list_reminders).",
      inputSchema: { id: z.string().min(1).describe("Reminder id") },
    },
    async ({ id }) => text(await (await owner()).cancelReminder(id)),
  );

  // ── Memory ─────────────────────────────────────────────────────────────
  server.registerTool(
    "get_memory",
    {
      title: "Get memory",
      description: "Read the durable facts Holston remembers about the owner.",
      inputSchema: {},
    },
    async () => text(await (await owner()).getMemory()),
  );

  server.registerTool(
    "save_memory",
    {
      title: "Save memory",
      description:
        "Replace the owner's durable memory block with new content (one fact per " +
        "line). This overwrites — include existing facts you want to keep.",
      inputSchema: {
        content: z.string().max(8000).describe("Full memory content to store"),
      },
    },
    async ({ content }) => text(await (await owner()).setMemory(content)),
  );

  // ── History search ─────────────────────────────────────────────────────
  server.registerTool(
    "search_history",
    {
      title: "Search conversation history",
      description: "Full-text search over the owner's conversation history.",
      inputSchema: {
        query: z.string().min(2).max(200).describe("Search query"),
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)"),
      },
    },
    async ({ query, limit }) =>
      text(await (await owner()).searchHistory(query, limit ?? 10)),
  );

  // ── Receipts (read-only audit) ─────────────────────────────────────────
  server.registerTool(
    "list_receipts",
    {
      title: "List action receipts",
      description:
        "List the owner's immutable action receipts (every gated action Holston " +
        "ran: sends, reminders, memory writes). Newest first.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe("Max rows (default 25)"),
      },
    },
    async ({ limit }) => text(await (await owner()).listReceipts(limit ?? 25)),
  );

  // ── System health ──────────────────────────────────────────────────────
  server.registerTool(
    "system_health",
    {
      title: "System health",
      description:
        "The owner's System Health events — scheduled-task, chat-recovery, " +
        "background-work, and MCP failures. Filter by minimum severity.",
      inputSchema: {
        severities: z
          .array(z.enum(["info", "warning", "error", "critical"]))
          .optional()
          .describe("Severities to include (default all)"),
        limit: z.number().int().min(1).max(100).optional().describe("Max rows (default 25)"),
      },
    },
    async ({ severities, limit }) =>
      text(await (await owner()).listEvents({ limit: limit ?? 25, severities })),
  );

  return server;
}

/**
 * Handle a `/mcp` request: bearer-gate, then hand off to the SDK's streamable
 * HTTP handler. Returns 401 without a valid key; returns null for non-/mcp
 * paths so the caller can continue routing.
 */
export async function handleMcp(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/mcp") return null;

  if (!env.MCP_ACCESS_KEY) {
    return new Response("MCP server not configured", { status: 404 });
  }
  if (!bearerOk(request.headers.get("authorization"), env.MCP_ACCESS_KEY)) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  const handler = createMcpHandler(buildHolstonMcpServer(env), { route: "/mcp" });
  return handler(request, env, ctx);
}
