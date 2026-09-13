import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8' }).trim().length > 0;
if ((process.env.CONTEXT === 'production' || process.env.RECEIVER_RELEASE === 'production') && dirty) throw new Error('Production releases require a clean tracked working tree');
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('A valid release commit is required');
const release = { revision, dirty, builtAt: new Date().toISOString(), node: process.version };
await writeFile(new URL('../app/release.ts', import.meta.url), `// Generated during the build; never contains credentials.\nexport const release = ${JSON.stringify(release)} as const;\n`);
await writeFile(new URL('../build/release.json', import.meta.url), JSON.stringify(release, null, 2));
