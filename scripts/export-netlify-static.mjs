import { cp, rm, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const outputDirectory = new URL("../dist/client/", import.meta.url);
await rm(outputDirectory, { recursive: true, force: true });
await cp(new URL("../out/", import.meta.url), outputDirectory, { recursive: true });
const html = await readFile(new URL("index.html", outputDirectory), "utf8");
const origins = JSON.parse(await readFile(new URL('../app/trusted-origins.json', import.meta.url), 'utf8'));
const scriptHashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(([,attributes,body]) => !/\bsrc=/.test(attributes) && body.trim())
  .map(([, ,body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`);
const imageSources = origins.images.flatMap(host => [`https://${host}`, `https://*.${host}`]).join(' ');
const csp = `default-src 'self'; script-src 'self' ${scriptHashes.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' ${imageSources}; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests`;
await writeFile(new URL('_headers', outputDirectory), `/*\n  Content-Security-Policy: ${csp}\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Strict-Transport-Security: max-age=31536000\n/index.html\n  Cache-Control: no-cache\n/release.json\n  Cache-Control: no-store\n`);
await writeFile(new URL('release.json', outputDirectory), await readFile(new URL('../build/release.json', import.meta.url)));

console.log("Generated dist/client/index.html for Netlify.");
