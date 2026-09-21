'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveDependencies } = require('../src/resolver');

test('resolves a simple transitive tree', () => {
  const registry = {
    a: { '1.0.0': { dependencies: { b: '^1.0.0' } } },
    b: { '1.0.0': {} },
  };
  const result = resolveDependencies(registry, { a: '^1.0.0' });
  assert.equal(result.resolved, true);
  assert.deepEqual(
    result.plan.map((p) => [p.name, p.version]),
    [
      ['a', '1.0.0'],
      ['b', '1.0.0'],
    ]
  );
  assert.deepEqual(result.installOrder, ['b', 'a']);
});

test('prefers the highest satisfying version', () => {
  const registry = {
    a: { '1.0.0': {}, '1.2.0': {}, '2.0.0': {} },
  };
  const result = resolveDependencies(registry, { a: '^1.0.0' });
  assert.equal(result.resolved, true);
  assert.deepEqual(result.plan, [{ name: 'a', version: '1.2.0', dependencies: {} }]);
});

test('backtracks to a lower version when the highest leads nowhere', () => {
  const registry = {
    a: {
      '1.0.0': { dependencies: { c: '^2.0.0' } },
      '0.9.0': { dependencies: { c: '^1.0.0' } },
    },
    c: { '1.5.0': {} },
  };
  const result = resolveDependencies(registry, { a: '*' });
  assert.equal(result.resolved, true);
  assert.deepEqual(
    result.plan.map((p) => [p.name, p.version]),
    [
      ['a', '0.9.0'],
      ['c', '1.5.0'],
    ]
  );
});

test('diamond dependencies resolve shared package once, satisfying all ranges', () => {
  const registry = {
    a: { '1.0.0': { dependencies: { b: '^1.0.0', c: '^1.0.0' } } },
    b: { '1.0.0': { dependencies: { d: '>=1.0.0 <2.0.0' } } },
    c: { '1.0.0': { dependencies: { d: '^1.1.0' } } },
    d: { '1.0.0': {}, '1.1.0': {}, '2.0.0': {} },
  };
  const result = resolveDependencies(registry, { a: '^1.0.0' });
  assert.equal(result.resolved, true);
  assert.deepEqual(
    result.plan.map((p) => [p.name, p.version]),
    [
      ['a', '1.0.0'],
      ['b', '1.0.0'],
      ['c', '1.0.0'],
      ['d', '1.1.0'],
    ]
  );
});

test('handles dependency cycles', () => {
  const registry = {
    a: { '1.0.0': { dependencies: { b: '^1.0.0' } } },
    b: { '1.0.0': { dependencies: { a: '^1.0.0' } } },
  };
  const result = resolveDependencies(registry, { a: '^1.0.0' });
  assert.equal(result.resolved, true);
  assert.deepEqual(result.installOrder.sort(), ['a', 'b']);
});

test('reports a conflict chain from root to the first package without candidates', () => {
  const registry = {
    a: { '1.0.0': { dependencies: { b: '^1.0.0' } } },
    b: { '1.0.0': { dependencies: { c: '^2.0.0' } } },
    c: { '1.0.0': {} },
  };
  const result = resolveDependencies(registry, { a: '^1.0.0' });
  assert.equal(result.resolved, false);
  assert.equal(result.reason, 'no-candidate');
  assert.equal(result.conflict.package, 'c');
  assert.deepEqual(result.conflict.required, [{ range: '^2.0.0', source: 'b@1.0.0' }]);
  assert.deepEqual(result.conflict.available, ['1.0.0']);
  assert.deepEqual(result.conflict.chain, [
    { name: 'a', version: '1.0.0', constraint: '^1.0.0', source: 'root' },
    { name: 'b', version: '1.0.0', constraint: '^1.0.0', source: 'a@1.0.0' },
    { name: 'c', version: null, constraint: '^2.0.0', source: 'b@1.0.0' },
  ]);
});

test('conflict when the root dependency is missing from the registry', () => {
  const result = resolveDependencies({}, { ghost: '^1.0.0' });
  assert.equal(result.resolved, false);
  assert.equal(result.conflict.package, 'ghost');
  assert.deepEqual(result.conflict.available, []);
  assert.deepEqual(result.conflict.chain, [
    { name: 'ghost', version: null, constraint: '^1.0.0', source: 'root' },
  ]);
});

test('conflict lists every constraint on the unsatisfiable package', () => {
  const registry = {
    a: { '1.0.0': { dependencies: { c: '^2.0.0' } } },
    b: { '1.0.0': { dependencies: { c: '<2.0.0' } } },
    c: { '1.0.0': {}, '2.1.0': {} },
  };
  const result = resolveDependencies(registry, { a: '^1.0.0', b: '^1.0.0' });
  assert.equal(result.resolved, false);
  assert.equal(result.conflict.package, 'c');
  assert.deepEqual(result.conflict.required, [
    { range: '^2.0.0', source: 'a@1.0.0' },
    { range: '<2.0.0', source: 'b@1.0.0' },
  ]);
});

test('is deterministic: identical output across runs and input key orderings', () => {
  const registry = {
    z: { '1.0.0': {}, '1.1.0': {} },
    a: { '1.0.0': { dependencies: { z: '^1.0.0', m: '^1.0.0' } } },
    m: { '1.0.0': { dependencies: { z: '^1.0.0' } } },
  };
  const root = { a: '^1.0.0' };
  const first = resolveDependencies(registry, root);
  const second = resolveDependencies(registry, root);
  assert.deepEqual(second, first);

  // Same data, different key insertion order -> identical result.
  const shuffledRegistry = {
    m: registry.m,
    a: registry.a,
    z: { '1.1.0': {}, '1.0.0': {} },
  };
  const third = resolveDependencies(shuffledRegistry, root);
  assert.deepEqual(third, first);
});

test('empty root resolves to an empty plan', () => {
  const result = resolveDependencies({}, {});
  assert.equal(result.resolved, true);
  assert.deepEqual(result.plan, []);
  assert.deepEqual(result.installOrder, []);
});
