// Front-end debug logging, gated by a single DEBUG flag shared with the backend.
//
// On boot, initDebug() asks the backend GET /api/config whether DEBUG is on
// (the backend reads the DEBUG env var). A localStorage flag ("ttb.debug") or a
// build-time VITE_DEBUG can force it on locally. When enabled, dlog() prints to
// the console AND forwards each entry to POST /api/client-log so the whole
// front+back trace shows up together in the backend (docker) logs.

let enabled = false
// Whether the backend's async VLM refinement tier is on (from /api/config). The
// UI uses this to decide whether to request the refine phase after the OCR verdict.
let vlm = false

type Level = "debug" | "info" | "warn" | "error"

/** True when the backend reports the async VLM refinement tier is enabled. */
export function isVlmEnabled(): boolean {
  return vlm
}

/** Resolve the debug flag from local overrides + the backend /api/config. */
export async function initDebug(): Promise<boolean> {
  // Local overrides win, so a developer can flip debug without the backend.
  let override = false
  try {
    override =
      localStorage.getItem("ttb.debug") === "1" ||
      localStorage.getItem("ttb.debug") === "true" ||
      import.meta.env.VITE_DEBUG === "1" ||
      import.meta.env.VITE_DEBUG === "true"
  } catch {
    // localStorage unavailable — ignore.
  }

  let backend = false
  try {
    const res = await fetch("/api/config")
    if (res.ok) {
      const body = (await res.json()) as { debug?: boolean; vlm?: boolean }
      backend = !!body.debug
      vlm = !!body.vlm
    }
  } catch {
    // Backend unreachable / endpoint absent — fall back to overrides only.
  }

  enabled = override || backend
  if (enabled) {
    // eslint-disable-next-line no-console
    console.info("[ttb] debug logging ON", { override, backend })
    void forward("info", "client.debug_enabled", { override, backend })
  }
  return enabled
}

/** Log a debug event to the console and forward it to the backend. No-op off. */
export function dlog(event: string, data?: unknown): void {
  if (!enabled) return
  // eslint-disable-next-line no-console
  console.debug(`[ttb] ${event}`, data ?? "")
  void forward("debug", event, data)
}

/** Log an error event (always to console; forwarded when debug is on). */
export function derror(event: string, data?: unknown): void {
  // eslint-disable-next-line no-console
  console.error(`[ttb] ${event}`, data ?? "")
  if (enabled) void forward("error", event, data)
}

/** Fire-and-forget POST to the backend client-log sink; failures are ignored. */
async function forward(level: Level, event: string, data: unknown): Promise<void> {
  try {
    await fetch("/api/client-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level, event, data: safe(data), ts: new Date().toISOString() }),
      keepalive: true,
    })
  } catch {
    // Never let logging break the app.
  }
}

/** Coerce arbitrary data into something JSON-serializable (errors → message). */
function safe(data: unknown): unknown {
  if (data instanceof Error) return { name: data.name, message: data.message }
  if (data === undefined) return null
  try {
    JSON.stringify(data)
    return data
  } catch {
    return String(data)
  }
}
