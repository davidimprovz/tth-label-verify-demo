import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import { initDebug, dlog } from './lib/debug'

// Resolve the shared DEBUG flag (backend /api/config + local overrides) and log
// boot. Fire-and-forget — never blocks first paint.
void initDebug().then(() => dlog('app.boot'))

// Wake the GPU VLM service early so its Cloud Run scale-from-zero cold start
// overlaps with the reviewer entering data (hides the spin-up). Best-effort; a
// no-op when the tier is off. Pinged on load and whenever the tab regains focus.
function warmup(): void {
  void fetch('/api/warmup', { method: 'POST', keepalive: true }).catch(() => {})
}
warmup()
window.addEventListener('focus', warmup)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') warmup()
})
// Heartbeat: while the tab is visible, re-ping every 5 min so the GPU's idle
// timer + Ollama keep_alive keep resetting and the model stays resident through
// an active session. Stops pinging when the tab is hidden → GPU scales to zero.
setInterval(() => {
  if (document.visibilityState === 'visible') warmup()
}, 5 * 60 * 1000)

// A QueryClient is wired at the root now so later data-fetching tasks can plug
// in without restructuring the app shell.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
