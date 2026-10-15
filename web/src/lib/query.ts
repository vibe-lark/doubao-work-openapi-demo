// The canonical QueryClient factory. Defaults are tuned for the realities of appData: data can be
// written out-of-band by the Agent (the sandbox's live copy), and multi-user apps also have other
// people writing concurrently — so "the window/iframe may be stale the moment it regains focus", which
// makes refetchOnWindowFocus:true the core switch (same source as @anygen/client's refresh-on-focus
// fallback via onUpdate), curing "hand-written useEffect+fetch UIs that stay stale forever".
//
// Mounting: see App.tsx — wrap the root component in <QueryClientProvider client={createQueryClient()}>
// (build the client once; a module-level singleton or useState(() => createQueryClient()) both work).
// The platform gives authors no runtime layer to touch, so App.tsx is the only mount point.
import { QueryClient } from '@tanstack/react-query';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Refetch on focus: this app's data is changed out-of-band at any time, so reconcile
        // automatically when returning to the tab and leave nothing stale.
        refetchOnWindowFocus: true,
        // Refetch after reconnecting.
        refetchOnReconnect: true,
        // Treat as fresh within 5s: dampens duplicate-request jitter within a single interaction;
        // past that it silently refetches at the next trigger.
        staleTime: 5_000,
        // Retry a failed read only once: gives network jitter a little slack, but does not hammer
        // retries and amplify a slow upstream into a timeout storm
        // (contract: external calls should fail-fast into an explicit error).
        retry: 1,
      },
      mutations: {
        // Writes do not auto-retry by default: an action may be non-idempotent (create a record,
        // dispatch a task, etc.) and blind retries would duplicate side effects. For writes that do
        // have an idempotency key (e.g. dedupeKey), override retry at that useAppMutation call site.
        retry: 0,
      },
    },
  });
}
