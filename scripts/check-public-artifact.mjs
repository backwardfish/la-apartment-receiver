import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const names = ['RENTCAST_API_KEY', 'GOOGLE_ROUTES_API_KEY', 'OPENAI_HOUSEHUNTER'];
const secrets = names.filter(name => process.env[name]?.length >= 8 && !/REDACT|\*{3}/i.test(process.env[name])).map(name => ({
  name,
  needles: [process.env[name], Buffer.from(process.env[name]).toString('base64'), encodeURIComponent(process.env[name])],
}));
let files = 0;
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { await scan(path); continue; }
    if (!entry.isFile()) throw new Error('Unexpected entry in public build output');
    const contents = await readFile(path);
    files++;
    for (const { name, needles } of secrets) {
      if (needles.some(needle => contents.includes(Buffer.from(needle)))) {
        throw new Error(`Public build contains a protected environment value (${name}); publication stopped`);
      }
    }
  }
}
await scan(new URL('../dist/client', import.meta.url).pathname);
console.log(`Checked ${files} public artifacts against ${secrets.length} configured credential values; none found. Secret scanning of Git history is separate.`);
