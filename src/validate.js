'use strict';

const semver = require('semver');

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Validate a POST /resolve body. Returns an array of human-readable problems,
 * or null when the body is valid.
 */
function validateRequest(body) {
  if (!isPlainObject(body)) return ['request body must be a JSON object'];

  const errors = [];
  const { registry, root } = body;

  if (!isPlainObject(registry)) {
    errors.push('"registry" must be an object mapping package names to version manifests');
  }
  if (!isPlainObject(root)) {
    errors.push('"root" must be an object mapping package names to semver ranges');
  }
  if (errors.length) return errors;

  for (const [name, versions] of Object.entries(registry)) {
    if (!isPlainObject(versions)) {
      errors.push(`registry["${name}"] must be an object mapping versions to manifests`);
      continue;
    }
    for (const [version, manifest] of Object.entries(versions)) {
      if (!semver.valid(version)) {
        errors.push(`registry["${name}"]: "${version}" is not a valid semver version`);
        continue;
      }
      if (!isPlainObject(manifest)) {
        errors.push(`registry["${name}"]["${version}"] must be an object`);
        continue;
      }
      const deps = manifest.dependencies;
      if (deps === undefined) continue;
      if (!isPlainObject(deps)) {
        errors.push(`registry["${name}"]["${version}"].dependencies must be an object`);
        continue;
      }
      for (const [dep, range] of Object.entries(deps)) {
        if (typeof range !== 'string' || !semver.validRange(range)) {
          errors.push(
            `registry["${name}"]["${version}"].dependencies["${dep}"] is not a valid semver range`
          );
        }
      }
    }
  }

  for (const [name, range] of Object.entries(root)) {
    if (typeof range !== 'string' || !semver.validRange(range)) {
      errors.push(`root["${name}"] is not a valid semver range`);
    }
  }

  return errors.length ? errors : null;
}

module.exports = { validateRequest };
