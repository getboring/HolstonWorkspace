import webpush from "web-push";
import type { PushSubscriptionRecord } from "./shared/state";

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  requireInteraction?: boolean;
}

export interface PushResult {
  /** Endpoints that returned 404/410 and should be pruned from state. */
  deadEndpoints: string[];
}

function vapidConfigured(env: Env): boolean {
  return Boolean(
    env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT,
  );
}

/**
 * Deliver a push notification to every subscription. Returns the endpoints
 * that are gone so the caller can drop them from agent state. Never throws —
 * push is best-effort.
 */
export async function sendPush(
  env: Env,
  subscriptions: PushSubscriptionRecord[],
  payload: PushPayload,
): Promise<PushResult> {
  if (!vapidConfigured(env) || subscriptions.length === 0) {
    return { deadEndpoints: [] };
  }

  webpush.setVapidDetails(
    env.VAPID_SUBJECT!,
    env.VAPID_PUBLIC_KEY!,
    env.VAPID_PRIVATE_KEY!,
  );

  const deadEndpoints: string[] = [];
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
      } catch (err: unknown) {
        const statusCode =
          err instanceof webpush.WebPushError ? err.statusCode : 0;
        if (statusCode === 404 || statusCode === 410) {
          deadEndpoints.push(sub.endpoint);
        } else {
          console.error(`[push] send failed for ${sub.endpoint}:`, err);
        }
      }
    }),
  );

  return { deadEndpoints };
}
