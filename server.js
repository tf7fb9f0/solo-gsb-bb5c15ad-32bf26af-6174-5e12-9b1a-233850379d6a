'use strict';

const express = require('express');
const { resolveDependencies } = require('./src/resolver');
const { validateRequest } = require('./src/validate');
const pkg = require('./package.json');

const PORT = Number(process.env.PORT || 3000);

const app = express();
app.use(express.json({ limit: process.env.MAX_BODY || '10mb' }));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: pkg.name,
    version: pkg.version,
    uptime: process.uptime(),
  });
});

app.get('/', (req, res) => {
  res.json({
    service: pkg.name,
    version: pkg.version,
    endpoints: {
      'POST /resolve': 'resolve an install plan from { registry, root }',
      'GET /health': 'liveness / health check',
    },
  });
});

app.post('/resolve', (req, res) => {
  const errors = validateRequest(req.body);
  if (errors) {
    return res.status(400).json({ error: 'invalid-request', details: errors });
  }
  const { registry, root } = req.body;
  const result = resolveDependencies(registry, root);
  if (result.resolved) {
    return res.json({
      resolved: true,
      plan: result.plan,
      installOrder: result.installOrder,
    });
  }
  return res.status(422).json({
    resolved: false,
    reason: result.reason,
    conflict: result.conflict,
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'not-found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid-json', message: err.message });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'payload-too-large' });
  }
  res.status(500).json({ error: 'internal-error' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`${pkg.name} v${pkg.version} listening on port ${PORT}`);
  });
}

module.exports = app;
