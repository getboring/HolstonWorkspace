import type { HolstonAgentConnection } from "../app";

/** Convert a VAPID base64url public key into the Uint8Array push wants. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Request notification permission, subscribe via the service worker using the
 * agent's VAPID public key, and register the subscription with the agent.
 * Returns false if push is unavailable or the user declines.
 */
export async function enablePush(agent: HolstonAgentConnection): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;

  const publicKey = await agent.stub.getVapidPublicKey();
  if (!publicKey) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const applicationServerKey = urlBase64ToUint8Array(publicKey);
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      // BufferSource; the ArrayBuffer slice avoids the SharedArrayBuffer union.
      applicationServerKey: applicationServerKey.buffer.slice(
        applicationServerKey.byteOffset,
        applicationServerKey.byteOffset + applicationServerKey.byteLength,
      ) as ArrayBuffer,
    }));

  await agent.stub.subscribePush(subscription.toJSON() as never);
  return true;
}

/**
 * Unsubscribe the browser push subscription and tell the agent to drop the
 * stored endpoint, so a user who turned push on can turn it back off from the
 * app (not only via browser settings). Best-effort: unregisters whatever this
 * browser has and clears the matching endpoint server-side.
 */
export async function disablePush(agent: HolstonAgentConnection): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      await agent.stub.unsubscribePush(existing.endpoint);
      await existing.unsubscribe();
    }
    return true;
  } catch {
    return false;
  }
}
