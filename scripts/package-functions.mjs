import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const output = '.netlify/verified-functions';
await mkdir(output, { recursive: true });
for (const [name, limit] of [['search',15],['search-status',60],['health',30],['direct-sources',15],['recommendations',15]]) {
  const file = `${output}/${name}.mjs`;
  await build({ entryPoints: [`netlify/functions/${name}.${['direct-sources','recommendations'].includes(name) ? 'mts' : 'ts'}`], outfile: file, bundle: true, platform: 'node', target: 'node22', format: 'esm', packages: 'external' });
  const fn = await import(pathToFileURL(resolve(file)).href);
  if (typeof fn.default !== 'function' || fn.config?.path !== `/api/${name}`) throw new Error(`Invalid function export or route: ${name}`);
  const rate = fn.config.rateLimit;
  if (rate?.windowLimit !== limit || rate.windowSize !== 60 || JSON.stringify(rate.aggregateBy) !== '["ip","domain"]') throw new Error(`Missing platform rate limit: ${name}`);
}
console.log('Compiled search, search-status, health, and direct-sources for Node 22; verified native routes and platform rate limits. Netlify performs final hosted packaging.');

await build({ entryPoints: ['netlify/functions/hourly-recommendations.mts'], outfile: `${output}/hourly-recommendations.mjs`, bundle: true, platform: 'node', target: 'node22', format: 'esm', packages: 'external' });
const hourly = await import(pathToFileURL(resolve(`${output}/hourly-recommendations.mjs`)).href);
if (typeof hourly.default !== 'function' || hourly.config?.schedule !== '0 * * * *' || hourly.config?.path) throw new Error('Hourly recommendations schedule is invalid');
console.log('Verified recommendations API and production hourly schedule.');
