export const DEFAULT_SEARCH_LIMITS = { daily: 25, monthly: 50 };
export type SearchLimits = typeof DEFAULT_SEARCH_LIMITS;
type Counter = { version: 1; day: string; month: string; daily: number; monthly: number };
export type BudgetStore = {
  read(): Promise<{ data: unknown; etag?: string } | null>;
  write(data: Counter, etag?: string): Promise<{ modified: boolean; etag?: string }>;
};

export class SearchBudgetError extends Error {
  code: 'search_allowance_exhausted' | 'search_allowance_unavailable';
  retryAfter?: number;
  constructor(code: SearchBudgetError['code'], retryAfter?: number) {
    super(code);
    this.name = 'SearchBudgetError';
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function searchLimits(get: (key: string) => string | undefined): SearchLimits {
  const parse = (key: string, fallback: number, maximum: number) => {
    const value = get(key);
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(value)) throw new SearchBudgetError('search_allowance_unavailable');
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1 || number > maximum) throw new SearchBudgetError('search_allowance_unavailable');
    return number;
  };
  return {
    daily: parse('RECEIVER_SEARCHES_PER_DAY', DEFAULT_SEARCH_LIMITS.daily, 1_000),
    monthly: parse('RECEIVER_SEARCHES_PER_MONTH', DEFAULT_SEARCH_LIMITS.monthly, 10_000),
  };
}

function readCounter(value: unknown, day: string): Counter {
  if (!value || typeof value !== 'object') throw new SearchBudgetError('search_allowance_unavailable');
  const counter = value as Counter;
  if (counter.version !== 1 || typeof counter.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(counter.day)
    || new Date(counter.day).toISOString().slice(0, 10) !== counter.day || counter.day > day
    || counter.month !== counter.day.slice(0, 7)
    || !Number.isSafeInteger(counter.daily) || counter.daily < 0
    || !Number.isSafeInteger(counter.monthly) || counter.monthly < counter.daily) {
    throw new SearchBudgetError('search_allowance_unavailable');
  }
  return counter;
}

/** Reserve before provider I/O. Failed searches retain their reservation because they may be billed. */
export async function reserveSearch(store: BudgetStore, limits: SearchLimits = DEFAULT_SEARCH_LIMITS, now = () => new Date()) {
  try {
    for (const limit of [limits.daily, limits.monthly]) {
      if (!Number.isSafeInteger(limit) || limit < 1) throw new SearchBudgetError('search_allowance_unavailable');
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = now();
      const day = current.toISOString().slice(0, 10);
      const month = day.slice(0, 7);
      const existing = await store.read();
      if (existing && !existing.etag) throw new SearchBudgetError('search_allowance_unavailable');
      const previous = existing ? readCounter(existing.data, day) : null;
      const daily = previous?.day === day ? previous.daily : 0;
      const monthly = previous?.month === month ? previous.monthly : 0;
      if (daily >= limits.daily || monthly >= limits.monthly) {
        const reset = monthly >= limits.monthly
          ? Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1)
          : Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate() + 1);
        throw new SearchBudgetError('search_allowance_exhausted', Math.max(1, Math.ceil((reset - current.getTime()) / 1000)));
      }
      const written = await store.write({ version: 1, day, month, daily: daily + 1, monthly: monthly + 1 }, existing?.etag);
      if (written.modified) {
        // Also reject the SDK's historical false-success result for failed conditional writes.
        if (!written.etag) throw new SearchBudgetError('search_allowance_unavailable');
        return;
      }
    }
    throw new SearchBudgetError('search_allowance_unavailable');
  } catch (error) {
    if (error instanceof SearchBudgetError) throw error;
    throw new SearchBudgetError('search_allowance_unavailable');
  }
}
