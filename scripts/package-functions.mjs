import { zipFunctions } from '@netlify/zip-it-and-ship-it';
import { mkdir, readFile } from 'node:fs/promises';

const output = '.netlify/verified-functions';
await mkdir(output, { recursive: true });
await zipFunctions('netlify/functions', output, {
  config: { '*': { nodeVersion: '22', nodeBundler: 'esbuild_zisi' } },
  manifest: `${output}/manifest.json`,
});
const manifest = JSON.parse(await readFile(`${output}/manifest.json`, 'utf8'));
for (const name of ['search', 'search-status', 'health']) {
  const fn = manifest.functions.find(fn => fn.name === name);
  if (fn?.runtimeVersion !== 'nodejs22.x' || !fn.routes?.some(route => route.pattern === `/api/${name}`)) {
    throw new Error(`Function runtime or routing mismatch: ${name}`);
  }
}
const search = manifest.functions.find(fn => fn.name === 'search');
if (search.trafficRules?.action?.config?.rateLimitConfig?.windowLimit !== 15) {
  throw new Error('Search package is missing its platform rate limit');
}
const status = manifest.functions.find(fn => fn.name === 'search-status');
if (status.trafficRules?.action?.config?.rateLimitConfig?.windowLimit !== 60) {
  throw new Error('Search-status package is missing its platform rate limit');
}
console.log('Packaged search, search-status, and health for Node 22 with verified routes and platform rate limits.');
