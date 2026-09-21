'use strict';

const semver = require('semver');

// Safety cap on backtracking steps so pathological registries cannot hang the
// process. Configurable via RESOLVER_MAX_STEPS.
const MAX_STEPS = Number(process.env.RESOLVER_MAX_STEPS || 200000);

/**
 * Resolve an install plan for `root` constraints against an offline registry.
 *
 * @param {Object} registry  { name: { version: { dependencies?: {name: range} } } }
 * @param {Object} root      { name: range }
 * @returns {{resolved: true, plan: Array, installOrder: string[]}
 *          | {resolved: false, reason: string, conflict: Object}}
 *
 * Search order (fully deterministic):
 *   - the lexicographically smallest unresolved package name is resolved next;
 *   - candidate versions are tried highest-first (semver descending);
 *   - on dead ends the search backtracks to the most recent choice.
 */
function resolveDependencies(registry, root) {
  // name -> [{ range, source }]  (source: "root" or "<name>@<version>")
  const constraints = new Map();
  // name -> selected version
  const resolved = new Map();
  // First "no candidate" conflict encountered in search order.
  let conflict = null;
  let steps = 0;
  let limitExceeded = false;

  for (const name of Object.keys(root).sort()) {
    addConstraint(name, root[name], 'root');
  }

  function addConstraint(name, range, source) {
    let arr = constraints.get(name);
    let created = false;
    if (!arr) {
      arr = [];
      constraints.set(name, arr);
      created = true;
    }
    arr.push({ range, source });
    return created;
  }

  function undoConstraints(undo) {
    for (let i = undo.length - 1; i >= 0; i--) {
      const u = undo[i];
      if (u.created) constraints.delete(u.name);
      else constraints.get(u.name).pop();
    }
  }

  // All registry versions satisfying every active constraint, highest first.
  function candidatesFor(name) {
    const versions = registry[name] ? Object.keys(registry[name]) : [];
    const reqs = constraints.get(name) || [];
    return versions
      .filter((v) => reqs.every((r) => semver.satisfies(v, r.range)))
      .sort(semver.rcompare);
  }

  // Lexicographically smallest package name that has constraints but no
  // selected version yet.
  function nextUnresolved() {
    let best = null;
    for (const name of constraints.keys()) {
      if (resolved.has(name)) continue;
      if (best === null || name < best) best = name;
    }
    return best;
  }

  function search() {
    if (++steps > MAX_STEPS) {
      limitExceeded = true;
      return false;
    }
    const name = nextUnresolved();
    if (name === null) return true; // nothing left to resolve

    const candidates = candidatesFor(name);
    if (candidates.length === 0) {
      if (conflict === null) conflict = buildConflict(name);
      return false;
    }

    for (const version of candidates) {
      const manifest = registry[name][version] || {};
      const deps = manifest.dependencies || {};
      const undo = [];
      let compatible = true;

      for (const depName of Object.keys(deps).sort()) {
        const range = deps[depName];
        const source = `${name}@${version}`;
        if (resolved.has(depName)) {
          // Already pinned (e.g. dependency cycle): the new constraint must
          // accept the pinned version, otherwise this candidate is unusable.
          if (!semver.satisfies(resolved.get(depName), range)) {
            compatible = false;
            break;
          }
        } else {
          undo.push({ name: depName, created: addConstraint(depName, range, source) });
        }
      }
      if (!compatible) {
        undoConstraints(undo);
        continue;
      }

      resolved.set(name, version);
      if (search()) return true;
      resolved.delete(name);
      undoConstraints(undo);
      if (limitExceeded) return false;
    }
    return false;
  }

  // Conflict chain from the root constraints down to the first package that
  // has no usable candidate. Each step records the selected version plus the
  // constraint (and its origin) that pulled the package in.
  function buildConflict(name) {
    const required = (constraints.get(name) || []).map((r) => ({
      range: r.range,
      source: r.source,
    }));
    const available = registry[name]
      ? Object.keys(registry[name]).sort(semver.rcompare)
      : [];

    const chain = [];
    const seen = new Set([name]);
    let current = name;
    for (;;) {
      const reqs = constraints.get(current) || [];
      const first = reqs[0] || null; // constraint that first pulled `current` in
      chain.unshift({
        name: current,
        version: resolved.has(current) ? resolved.get(current) : null,
        constraint: first ? first.range : null,
        source: first ? first.source : null,
      });
      if (!first || first.source === 'root') break;
      const at = first.source.lastIndexOf('@');
      const parentName = at > 0 ? first.source.slice(0, at) : first.source;
      if (seen.has(parentName)) break; // defensive; cannot happen in practice
      seen.add(parentName);
      current = parentName;
    }
    return { package: name, required, available, chain };
  }

  if (search()) {
    const names = [...resolved.keys()].sort();
    const plan = names.map((n) => ({
      name: n,
      version: resolved.get(n),
      dependencies:
        (registry[n][resolved.get(n)] && registry[n][resolved.get(n)].dependencies) || {},
    }));
    return {
      resolved: true,
      plan,
      installOrder: topoOrder(names, registry, resolved),
    };
  }

  if (limitExceeded) {
    return { resolved: false, reason: 'search-limit-exceeded', conflict };
  }
  return { resolved: false, reason: 'no-candidate', conflict };
}

// Dependencies before dependents; ties broken lexicographically so the output
// order is stable for identical input.
function topoOrder(names, registry, resolved) {
  const set = new Set(names);
  const indegree = new Map();
  const dependents = new Map();
  for (const n of names) {
    indegree.set(n, 0);
    dependents.set(n, []);
  }
  for (const n of names) {
    const deps = (registry[n][resolved.get(n)] && registry[n][resolved.get(n)].dependencies) || {};
    for (const d of Object.keys(deps)) {
      if (!set.has(d)) continue;
      indegree.set(n, indegree.get(n) + 1);
      dependents.get(d).push(n);
    }
  }
  const ready = names.filter((n) => indegree.get(n) === 0).sort();
  const order = [];
  const emitted = new Set();
  while (order.length < names.length) {
    if (ready.length === 0) {
      // Dependency cycle: no node is fully unblocked. Emit the
      // lexicographically smallest remaining node to keep the order
      // deterministic while still listing every package.
      const rest = names.filter((n) => !emitted.has(n)).sort();
      ready.push(rest[0]);
    }
    const n = ready.shift();
    if (emitted.has(n)) continue;
    emitted.add(n);
    order.push(n);
    for (const m of dependents.get(n)) {
      indegree.set(m, indegree.get(m) - 1);
      if (indegree.get(m) === 0) {
        const i = ready.findIndex((x) => x > m);
        if (i === -1) ready.push(m);
        else ready.splice(i, 0, m);
      }
    }
  }
  return order;
}

module.exports = { resolveDependencies };
