'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');

function startServer() {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function post(server, path, body) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('GET /health reports ok', async () => {
  const server = await startServer();
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
  } finally {
    server.close();
  }
});

test('POST /resolve returns 200 with a plan on success', async () => {
  const server = await startServer();
  try {
    const { status, body } = await post(server, '/resolve', {
      registry: {
        app: { '1.0.0': { dependencies: { lib: '^1.0.0' } } },
        lib: { '1.0.0': {}, '1.1.0': {} },
      },
      root: { app: '^1.0.0' },
    });
    assert.equal(status, 200);
    assert.equal(body.resolved, true);
    assert.deepEqual(
      body.plan.map((p) => [p.name, p.version]),
      [
        ['app', '1.0.0'],
        ['lib', '1.1.0'],
      ]
    );
    assert.deepEqual(body.installOrder, ['lib', 'app']);
  } finally {
    server.close();
  }
});

test('POST /resolve returns 422 with a conflict chain when unsatisfiable', async () => {
  const server = await startServer();
  try {
    const { status, body } = await post(server, '/resolve', {
      registry: {
        app: { '1.0.0': { dependencies: { lib: '^2.0.0' } } },
        lib: { '1.0.0': {} },
      },
      root: { app: '^1.0.0' },
    });
    assert.equal(status, 422);
    assert.equal(body.resolved, false);
    assert.equal(body.conflict.package, 'lib');
    assert.deepEqual(body.conflict.chain, [
      { name: 'app', version: '1.0.0', constraint: '^1.0.0', source: 'root' },
      { name: 'lib', version: null, constraint: '^2.0.0', source: 'app@1.0.0' },
    ]);
  } finally {
    server.close();
  }
});

test('POST /resolve returns 400 for malformed input', async () => {
  const server = await startServer();
  try {
    const missing = await post(server, '/resolve', { root: { a: '^1.0.0' } });
    assert.equal(missing.status, 400);

    const badRange = await post(server, '/resolve', {
      registry: {},
      root: { a: 'not-a-range' },
    });
    assert.equal(badRange.status, 400);
    assert.ok(Array.isArray(badRange.body.details));

    const badVersion = await post(server, '/resolve', {
      registry: { a: { '1.x': {} } },
      root: {},
    });
    assert.equal(badVersion.status, 400);
  } finally {
    server.close();
  }
});

test('POST /resolve returns 400 for invalid JSON', async () => {
  const server = await startServer();
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{nope',
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'invalid-json');
  } finally {
    server.close();
  }
});
