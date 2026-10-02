import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import channel from '../agent/channels/eve.ts';

// These tests exercise routing/auth only: no server, credentials or model calls.
function environment(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
}

for (const path of ['/eve/v1/info', '/eve/v1/session']) {
  test(`${path} rejects unauthenticated production requests, even on localhost`, async (t) => {
    environment(t, { NODE_ENV: 'production', EVE_DEV: undefined, VERCEL: undefined, VERCEL_ENV: undefined });
    const route = channel.routes.find((route) => route.path === path);
    const response = await route.handler(new Request(`http://localhost${path}`, {
      method: route.method,
    }), {});
    assert.equal(response.status, 401);
  });
}

test('health remains available without invoking a model', async () => {
  const route = channel.routes.find((route) => route.path === '/eve/v1/health' && route.method === 'GET');
  const response = await route.handler(new Request('http://localhost/eve/v1/health'), {});
  assert.equal(response.status, 200);
});

test('Next config emits local rewrites and a generated Vercel Eve service', async (t) => {
  environment(t, {
    NODE_ENV: 'production', VERCEL: undefined,
    EVE_NEXT_PRODUCTION_ORIGIN: undefined, EVE_NEXT_PRODUCTION_PORT: undefined,
  });
  const root = process.cwd();
  const temp = await mkdtemp(join(tmpdir(), 'eve-setup-test-'));
  try {
    // Isolate generated deployment artifacts from the real project.
    await symlink(join(root, 'node_modules'), join(temp, 'node_modules'), 'dir');
    process.chdir(temp);
    const { default: config } = await import('../next.config.ts');
    const local = await config('phase-production-build', { defaultConfig: {} });
    assert.deepEqual((await local.rewrites()).beforeFiles, [{
      source: '/eve/v1/:path+',
      destination: 'http://127.0.0.1:4274/eve/v1/:path+',
    }]);
    process.env.VERCEL = '1';
    const vercel = await config('phase-production-build', { defaultConfig: {} });
    assert.equal(vercel.rewrites, undefined);
    const output = JSON.parse(await readFile(join(temp, '.vercel/output/config.json'), 'utf8'));
    assert.equal(output.version, 3);
    assert.equal(output.services.eve.framework, 'eve');
    assert.match(output.services.eve.buildCommand, /eve\.js' build$/);
    assert.deepEqual(output.routes[0], {
      destination: { service: 'eve', type: 'service' },
      src: '^/eve/v1/(.*)$',
    });
  } finally {
    process.chdir(root);
    await rm(temp, { recursive: true, force: true });
  }
});
