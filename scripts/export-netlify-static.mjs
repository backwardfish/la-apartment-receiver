import { mkdir, writeFile } from "node:fs/promises";
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
await writeFile(new URL("index.html", outputDirectory), await response.text(), "utf8");

console.log("Generated dist/client/index.html for Netlify.");
