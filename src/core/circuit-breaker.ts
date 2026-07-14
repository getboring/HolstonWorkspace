/**
 * Lightweight circuit breaker for external API calls.
 *
 * States:
 * - closed: normal operation, requests pass through
 * - open: too many failures, requests skip to fallback
 * - half-open: after reset timeout, allow one trial request
 *
 * In-memory only — resets on Worker restart. Acceptable for edge Workers
 * where instances are short-lived.
 *
 * Extracted from getboring/holston-pulse/src/core/platform/circuit-breaker.ts
 */

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
}

export interface CircuitEntry {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureTime: number;
}

const DEFAULT_CONFIG: CircuitConfig = {
  failureThreshold: 3,
  resetTimeoutMs: 30_000,
};

const circuits = new Map<string, CircuitEntry>();

function getCircuit(name: string): CircuitEntry {
  let entry = circuits.get(name);
  if (!entry) {
    entry = { state: "closed", consecutiveFailures: 0, lastFailureTime: 0 };
    circuits.set(name, entry);
  }
  return entry;
}

function recordSuccess(name: string): void {
  const entry = getCircuit(name);
  entry.state = "closed";
  entry.consecutiveFailures = 0;
}

function recordFailure(name: string, config: CircuitConfig): void {
  const entry = getCircuit(name);
  entry.consecutiveFailures += 1;
  entry.lastFailureTime = Date.now();
  if (entry.state === "closed" && entry.consecutiveFailures >= config.failureThreshold) {
    entry.state = "open";
  } else if (entry.state === "half-open") {
    entry.state = "open";
  }
}

function shouldAllow(name: string, config: CircuitConfig): boolean {
  const entry = getCircuit(name);
  if (entry.state === "closed") return true;
  if (entry.state === "open") {
    const elapsed = Date.now() - entry.lastFailureTime;
    if (elapsed >= config.resetTimeoutMs) {
      entry.state = "half-open";
      return true;
    }
    return false;
  }
  return true;
}

/**
 * Execute a function with circuit breaker protection.
 * If the circuit is open, returns the fallback immediately.
 */
export async function withCircuitBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  fallback: T,
  config: Partial<CircuitConfig> = {},
): Promise<T> {
  const cfg: CircuitConfig = { ...DEFAULT_CONFIG, ...config };
  if (!shouldAllow(name, cfg)) return fallback;
  try {
    const result = await fn();
    recordSuccess(name);
    return result;
  } catch (_err) {
    recordFailure(name, cfg);
    return fallback;
  }
}

/**
 * Race a promise against a timeout.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallback);
      }
    }, ms);
    promise
      .then((value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      })
      .catch(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(fallback);
        }
      });
  });
}

export function getCircuitState(name: string): CircuitState {
  return getCircuit(name).state;
}

export function resetCircuit(name: string): void {
  circuits.delete(name);
}

export function resetAllCircuits(): void {
  circuits.clear();
}
