import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import { initDebug, dlog } from './lib/debug'

// Resolve the shared DEBUG flag (backend /api/config + local overrides) and log
// boot. Fire-and-forget — never blocks first paint.
void initDebug().then(() => dlog('app.boot'))

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
