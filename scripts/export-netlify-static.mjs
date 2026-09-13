import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const workerUrl = pathToFileURL(`${projectRoot}/dist/server/index.js`);
workerUrl.searchParams.set("netlify-static-export", `${process.pid}-${Date.now()}`);

const { default: worker } = await import(workerUrl.href);
if (!worker || typeof worker.fetch !== "function") {
  throw new Error("Unable to render the Receiver for Netlify static hosting.");
}

const response = await worker.fetch(
  new Request("https://la-apartment-receiver.netlify.app/", {
    headers: { accept: "text/html" },
  }),
  {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
  },
  {
    waitUntil() {},
    passThroughOnException() {},
  },
);

if (!response.ok) {
  throw new Error(`Static render failed with status ${response.status}.`);
}

const outputDirectory = new URL("../dist/client/", import.meta.url);
await mkdir(outputDirectory, { recursive: true });
const html = await response.text();
await writeFile(new URL("index.html", outputDirectory), html, "utf8");
const origins = JSON.parse(await readFile(new URL('../app/trusted-origins.json', import.meta.url), 'utf8'));
const scriptHashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(([,attributes,body]) => !/\bsrc=/.test(attributes) && body.trim())
  .map(([, ,body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`);
const imageSources = origins.images.flatMap(host => [`https://${host}`, `https://*.${host}`]).join(' ');
const csp = `default-src 'self'; script-src 'self' ${scriptHashes.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' ${imageSources}; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests`;
await writeFile(new URL('_headers', outputDirectory), `/*\n  Content-Security-Policy: ${csp}\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Strict-Transport-Security: max-age=31536000\n/index.html\n  Cache-Control: no-cache\n/release.json\n  Cache-Control: no-store\n`);
await writeFile(new URL('release.json', outputDirectory), await readFile(new URL('../build/release.json', import.meta.url)));

console.log("Generated dist/client/index.html for Netlify.");
