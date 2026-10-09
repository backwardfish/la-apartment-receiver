#!/usr/bin/env bash
set -euo pipefail
node --input-type=module <<'NODE'
import { readFile, access } from 'node:fs/promises';
const html = await readFile('out/index.html', 'utf8');
if (!/<title>LA Apartment Receiver<\/title>/.test(html) || !html.includes('Describe your direct source search')) throw new Error('Static export is missing the Receiver UI');
for (const [, src] of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
  if (!src.startsWith('/_next/')) throw new Error('Unexpected script origin');
  await access(`out${src}`);
}
console.log('Validated prerendered Receiver HTML and every referenced client script.');
NODE
