import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';

test('dashboard, readiness and disconnected feed status; private files cannot be served', async (t) => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.match(await home.text(), /<title>SMC Dashboard/);
  assert.equal((await fetch(base + '/healthz')).status, 200);
  const state = await (await fetch(base + '/api/status')).json();
  assert.equal(state.realtimeConnected, false);
  assert.equal(state.stage, 'web-server-only');
  for (const path of ['/.env', '/server.mjs', '/package.json', '/.git/config', '/%2e%2e/.env']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  const head = await fetch(base, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});
