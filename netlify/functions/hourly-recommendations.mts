import type { Config, Context } from '@netlify/functions';
import { refreshRecommendationInventory } from '../../app/recommendation-inventory.ts';
import { recommendationCache } from './recommendations.mts';
export default async (_request: Request, context: Context) => {
  if (context.deploy.context !== 'production') return;
  const value = await refreshRecommendationInventory(recommendationCache(context));
  console.info(JSON.stringify({ event: 'recommendations_refreshed', refreshedAt: value.refreshedAt, sources: value.sources.map(source => ({ name: source.name, status: source.status, count: source.count })) }));
};
// Every clock hour in UTC, also every clock hour in Los Angeles across DST.
export const config: Config = { schedule: '0 * * * *' };
