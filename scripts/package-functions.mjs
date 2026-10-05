import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const output = '.netlify/verified-functions';
await mkdir(output, { recursive: true });
for (const [name, limit] of [['search',15],['search-status',60],['health',30]]) {
  const file = `${output}/${name}.mjs`;
  await build({ entryPoints: [`netlify/functions/${name}.ts`], outfile: file, bundle: true, platform: 'node', target: 'node22', format: 'esm', packages: 'external' });
  const fn = await import(pathToFileURL(resolve(file)).href);
  if (typeof fn.default !== 'function' || fn.config?.path !== `/api/${name}`) throw new Error(`Invalid function export or route: ${name}`);
  const rate = fn.config.rateLimit;
  if (rate?.windowLimit !== limit || rate.windowSize !== 60 || JSON.stringify(rate.aggregateBy) !== '["ip","domain"]') throw new Error(`Missing platform rate limit: ${name}`);
}
console.log('Compiled search, search-status, and health for Node 22; verified native routes and platform rate limits. Netlify performs final hosted packaging.');
