import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("renders production metadata", async () => {
  const html = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>LA Apartment Receiver<\/title>/i);
  assert.doesNotMatch(html, /codex-preview/i);
  assert.match(html, /Direct sources/);
  assert.match(html, /Describe your direct source search/);
  assert.doesNotMatch(html, /All Los Angeles/);
});
test("creates a static Netlify entry point", async () => {
  await access(new URL("../dist/client/index.html", import.meta.url));
  const html = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  assert.match(html, /<html[^>]*>/i);
  assert.match(html, /LA Apartment Receiver/i);
});
