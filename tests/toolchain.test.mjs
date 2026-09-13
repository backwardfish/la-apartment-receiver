import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { transform, transformSync } from '@esbuild-kit/core-utils';

test('the Drizzle TypeScript loader works with its patched esbuild dependency', async () => {
  const source = 'const value: number = 6; export default value * 7;';
  const commonjs = transformSync(source, '/receiver/fixture.ts');
  const sandboxModule = { exports: {} };
  runInNewContext(commonjs.code, { module: sandboxModule, exports: sandboxModule.exports });
  assert.equal(sandboxModule.exports.default, 42);
  assert.ok(commonjs.map);
  const esm = await transform(source, '/receiver/fixture.mts');
  assert.equal((await import(`data:text/javascript,${encodeURIComponent(esm.code)}`)).default, 42);
  assert.ok(esm.map);
});
