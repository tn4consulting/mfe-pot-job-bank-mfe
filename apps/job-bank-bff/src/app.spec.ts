import request from 'supertest';
import { createApp } from './app';

// The real JWKS-based JWT verification and the whoami response shape are
// both covered by shared-auth-server's own tests -- this only proves
// /api/whoami wires the middleware and handler together correctly.
jest.mock('@tn4consulting/shared-auth-server', () => ({
  verifyBearerToken:
    () =>
    (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
      if (req.headers.authorization === 'Bearer valid-token') {
        req.auth = { sub: 'citizen-abc123', name: 'Alex Chen', sin: '123-456-789', claims: [] };
        next();
        return;
      }
      res.status(401).json({ error: 'Invalid or expired token' });
    },
  whoamiHandler: (req: import('express').Request, res: import('express').Response) => {
    if (!req.auth) {
      res.status(401).json({ error: 'Missing verified identity' });
      return;
    }
    res.json({ sub: req.auth.sub, name: req.auth.name, sinMasked: 'MASKED' });
  },
}));

describe('job-bank-bff', () => {
  const app = createApp();

  it('reports healthy', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  it('reports ready when its own sessionCache round-trip succeeds', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('lists job postings', async () => {
    const res = await request(app).get('/api/jobs');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('creates an application for a valid posting', async () => {
    const res = await request(app)
      .post('/api/applications')
      .send({ jobId: 'job-001', applicantSub: 'mock-citizen-001' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      jobId: 'job-001',
      applicantSub: 'mock-citizen-001',
      status: 'submitted',
    });
  });

  it('rejects an application for an unknown posting', async () => {
    const res = await request(app)
      .post('/api/applications')
      .send({ jobId: 'does-not-exist', applicantSub: 'mock-citizen-001' });
    expect(res.status).toBe(404);
  });

  it('rejects an application missing required fields', async () => {
    const res = await request(app).post('/api/applications').send({ jobId: 'job-001' });
    expect(res.status).toBe(400);
  });

  it('lists applications for a given applicant', async () => {
    await request(app)
      .post('/api/applications')
      .send({ jobId: 'job-002', applicantSub: 'mock-citizen-001' });

    const res = await request(app).get('/api/applications').query({ applicantSub: 'mock-citizen-001' });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it('denormalizes job title and employer onto each application', async () => {
    await request(app)
      .post('/api/applications')
      .send({ jobId: 'job-001', applicantSub: 'mock-citizen-005' });

    const res = await request(app)
      .get('/api/applications')
      .query({ applicantSub: 'mock-citizen-005' });

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      jobId: 'job-001',
      jobTitle: 'Warehouse Associate',
      employer: 'Northgate Logistics',
    });
  });

  it('requires the applicantSub query parameter', async () => {
    const res = await request(app).get('/api/applications');
    expect(res.status).toBe(400);
  });

  it('returns the verified identity for /api/whoami', async () => {
    const res = await request(app).get('/api/whoami').set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sub: 'citizen-abc123', name: 'Alex Chen', sinMasked: 'MASKED' });
  });

  it('rejects /api/whoami without a valid bearer token', async () => {
    const res = await request(app).get('/api/whoami');
    expect(res.status).toBe(401);
  });

  it('clears applications for a sub after /api/reset', async () => {
    await request(app)
      .post('/api/applications')
      .send({ jobId: 'job-001', applicantSub: 'mock-citizen-reset' });

    const resetRes = await request(app).post('/api/reset');
    expect(resetRes.status).toBe(204);

    const res = await request(app).get('/api/applications').query({ applicantSub: 'mock-citizen-reset' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('job-bank-bff error handling', () => {
  // A rejected sessionCache call (the real-world shape of "Redis is
  // unreachable") should degrade gracefully, not surface Express's bare
  // default 500 HTML page -- see app.ts's own last-resort error handler
  // comment and mfe-pot/TODO.md's "Design principles" section,
  // principle 5. jest.resetModules() + a fresh require is safe here (no
  // React involved, unlike a frontend spec) -- see shared-observability's
  // own spec file for the identical pattern.
  beforeEach(() => {
    jest.resetModules();
  });

  it('returns a degraded 503 envelope, not a bare 500, when sessionCache rejects', async () => {
    jest.doMock('./config', () => ({
      sessionCache: {
        getJson: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        setJson: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        reset: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        buildKey: (...parts: string[]) => parts.join(':'),
      },
      mockIdp: { jwksUrl: 'http://localhost/jwks', issuer: 'http://localhost', audience: 'test' },
    }));

    const { createApp } = require('./app');
    const app = createApp();

    const res = await request(app).get('/api/applications').query({ applicantSub: 'anyone' });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Service temporarily unavailable', degraded: true });
  });
});
