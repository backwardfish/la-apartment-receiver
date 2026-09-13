import type { Config } from '@netlify/functions';
import { release } from '../../app/release.ts';
const health = async () => new Response(JSON.stringify({ status: 'ok', release, runtimeNode: process.version }), {
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
});
export default health;
export const config: Config = { path: '/api/health' };
