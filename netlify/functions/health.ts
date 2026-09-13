import type { Config } from '@netlify/functions';
import { release } from '../../app/release.ts';
import { budgetStore } from '../../app/netlify-search-budget.ts';

export const createHealthHandler = (readAllowance = () => budgetStore().read()) => async (request: Request) => {
  let allowanceStore: 'reachable' | 'unavailable' | undefined;
  if (new URL(request.url).searchParams.get('readiness') === '1') {
    try { await readAllowance(); allowanceStore = 'reachable'; }
    catch { allowanceStore = 'unavailable'; }
  }
  const available = allowanceStore !== 'unavailable';
  return new Response(JSON.stringify({ status: available ? 'ok' : 'degraded', release, runtimeNode: process.version, ...(allowanceStore ? { allowanceStore } : {}) }), {
  status: available ? 200 : 503,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
});
};
export default createHealthHandler();
export const config: Config = { path: '/api/health', rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
