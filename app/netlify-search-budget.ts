import { getStore } from '@netlify/blobs';
import { reserveSearch, searchLimits, SearchBudgetError, type BudgetStore } from './search-budget.ts';

async function withinDeadline<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new SearchBudgetError('search_allowance_unavailable');
  return new Promise((resolve, reject) => {
    const abort = () => reject(new SearchBudgetError('search_allowance_unavailable'));
    signal.addEventListener('abort', abort, { once: true });
    operation().then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** No query text, addresses, IPs, or credentials are stored in the allowance record. */
export function budgetStore(options: { name?: string; siteID?: string; token?: string; fetcher?: typeof fetch; signal?: AbortSignal } = {}): BudgetStore {
  const store = getStore({
    name: options.name ?? 'receiver-search-allowance-v1',
    consistency: 'strong',
    ...(options.siteID ? { siteID: options.siteID } : {}),
    ...(options.token ? { token: options.token } : {}),
    fetch: async (input, init) => {
      const signal = options.signal ?? AbortSignal.timeout(8_000);
      if (signal.aborted) throw new SearchBudgetError('search_allowance_unavailable');
      const result = await (options.fetcher ?? fetch)(input, { ...init, redirect: 'error', signal });
      const method = init?.method?.toUpperCase() ?? 'GET';
      // Conditional writes in @netlify/blobs 11.0.3 can swallow non-412 errors.
      if (result.status !== 200 && !(method === 'GET' && result.status === 404) && !(method === 'PUT' && result.status === 412)) {
        throw new SearchBudgetError('search_allowance_unavailable');
      }
      return result;
    },
  });
  return {
    read: () => {
      const signal = options.signal ?? AbortSignal.timeout(8_000);
      return withinDeadline(() => store.getWithMetadata('usage', { type: 'json', consistency: 'strong' }), signal);
    },
    write: (data, etag) => {
      const signal = options.signal ?? AbortSignal.timeout(8_000);
      return withinDeadline(() => store.setJSON('usage', data, etag ? { onlyIfMatch: etag } : { onlyIfNew: true }), signal);
    },
  };
}

export async function reserveNetlifySearch(get: (key: string) => string | undefined) {
  try {
    await reserveSearch(budgetStore(), searchLimits(get));
  } catch (error) {
    if (error instanceof SearchBudgetError) throw error;
    throw new SearchBudgetError('search_allowance_unavailable');
  }
}
