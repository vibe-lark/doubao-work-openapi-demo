// The canonical data-layer hooks: collapse the highest-frequency pattern ("read a collection → render
// → mutate → refresh") into two hooks so generated code is structurally hard to get wrong. Design
// principle: stay close to TanStack Query v5's native shapes (the model already knows them) and only
// collapse three things —
//   ① query-key convention (always prefixed with ['appdata', ...] so invalidate can batch by prefix)
//   ② auto-invalidate on mutation success ("refresh after write" is no longer wired by hand)
//   ③ error unwrapping (@anygen/client already normalizes backend errors into Error(backend message);
//      read the text uniformly, never swallow it)
// Nothing else is abstracted; reach for native useQuery/useMutation directly when you need more of TanStack.
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';

// Query key: pass a string or an array; internally flattened to ['appdata', ...segments].
// e.g. 'items' → ['appdata','items']; ['item', id] → ['appdata','item',id].
export type AppDataKey = string | readonly unknown[];

function normalizeKey(key: AppDataKey): unknown[] {
  return ['appdata', ...(Array.isArray(key) ? key : [key])];
}

// useAppData — read a collection/entity derived from appData. A thin wrapper over useQuery:
//   · key convention: automatically prefixed with ['appdata', ...key]
//   · everything else passes through the TanStack result untouched (data / isLoading / isError / error
//     / refetch ...), which the model knows.
// The fetcher is usually some @api/app read action, e.g. () => listItems(); the generic T is inferred
// from the fetcher's return type (the z.infer type wired to @shared/schema), no need to write it by hand.
export function useAppData<T>(
  key: AppDataKey,
  fetcher: () => Promise<T>,
  options?: {
    /** Conditional enable (e.g. only query once some id is ready). */
    enabled?: boolean;
    /** Override the default staleTime (ms). */
    staleTime?: number;
    /** Poll interval (ms); use it when harvesting a running job; omitted means no polling. */
    refetchInterval?: number | false;
  },
): UseQueryResult<T, Error> {
  return useQuery<T, Error>({
    queryKey: normalizeKey(key),
    queryFn: fetcher,
    ...options,
  });
}

// useAppMutation — write an appData action and auto-invalidate the given reads on success, so
// "refresh after write" happens structurally.
//   · mutationFn is usually some @api/app write action, e.g. (input) => createItem({ data: input }).
//   · invalidates: the read keys to invalidate after a successful write (auto-prefixed with ['appdata', ...]);
//     omitted means invalidate the whole ['appdata'] namespace (least likely to miss a refresh; narrow it
//     down explicitly when there are many reads and you want to name only the affected keys).
//   · does not swallow failures: the error is already normalized by @anygen/client into Error(the message
//     thrown by the backend); use errText to pull the text into a Toast.
export function useAppMutation<TData, TVariables = void>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  opts?: {
    invalidates?: AppDataKey[];
    onSuccess?: (data: TData, variables: TVariables) => void;
    onError?: (error: Error, variables: TVariables) => void;
  },
): UseMutationResult<TData, Error, TVariables> {
  const qc = useQueryClient();
  return useMutation<TData, Error, TVariables>({
    // Forward ONLY variables. TanStack Query >=5.100 calls mutationFn(variables, context) with a second
    // context arg ({ client, meta, mutationKey }); @api/* action stubs pick the LAST object argument as
    // the request payload, so passing an action directly here would send the context instead of the
    // payload -- the request goes out with an empty body and every Data(...) action 400s.
    mutationFn: (variables: TVariables) => mutationFn(variables),
    onSuccess: (data, variables) => {
      const targets = opts?.invalidates;
      if (targets && targets.length) {
        for (const k of targets) qc.invalidateQueries({ queryKey: normalizeKey(k) });
      } else {
        qc.invalidateQueries({ queryKey: ['appdata'] });
      }
      opts?.onSuccess?.(data, variables);
    },
    onError: opts?.onError,
  });
}

// errText — a small error-unwrapping helper. @anygen/client already normalizes a backend non-2xx
// response into an Error: .message is the human-readable sentence the backend threw (e.g. "Only the
// owner can…"), .status is the HTTP code. Use it in the UI to pull the text into a Toast; never swallow
// the error into the console (contract: wrap every frontend async call in try/catch and surface the
// failure in plain language).
export function errText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return 'Operation failed, please try again';
}
