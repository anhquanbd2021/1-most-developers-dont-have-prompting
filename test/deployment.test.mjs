import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaticServer } from '../app/server.js';

async function withServer(fn) {
  const server = createStaticServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}

test('health and version endpoints', async () => {
  await withServer(async base => {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), 'ok');
    const version = await fetch(`${base}/version`);
    assert.equal(version.status, 200);
    const body = await version.json();
    assert.equal(body.name, 'instruction-router-demo');
  });
});

test('allowlisted assets serve with CSP; everything else 404s', async () => {
  await withServer(async base => {
    for (const path of ['/', '/guide.html', '/styles.css', '/app.js', '/router.mjs']) {
      const res = await fetch(base + path);
      assert.equal(res.status, 200, path);
      assert.ok(res.headers.get('content-security-policy'), path);
    }
    const res = await fetch(`${base}/../etc/passwd`);
    assert.equal(res.status, 404);
    const missing = await fetch(`${base}/nope.js`);
    assert.equal(missing.status, 404);
  });
});

test('example JSON endpoints serve the on-disk fixtures', async () => {
  await withServer(async base => {
    const instr = await (await fetch(`${base}/instructions.json`)).json();
    assert.equal(instr.instructions.length, 11);
    const mis = await (await fetch(`${base}/misrouted.json`)).json();
    assert.equal(mis.placements.length, 6);
  });
});

test('POST is rejected; HEAD works', async () => {
  await withServer(async base => {
    const post = await fetch(`${base}/`, { method: 'POST' });
    assert.equal(post.status, 404);
    const head = await fetch(`${base}/`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  });
});
