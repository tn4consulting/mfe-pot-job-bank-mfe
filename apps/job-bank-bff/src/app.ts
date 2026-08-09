import cors from 'cors';
import express, { Express } from 'express';
import { verifyBearerToken, whoamiHandler } from '@tn4consulting/shared-auth-server';
import { mockIdp, sessionCache } from './config';
import { createApplication, getApplications, getPosting, postings } from './data';

/**
 * Job Bank's own dedicated backend -- pays off the "Job Bank must be
 * reusable outside this shell" requirement (a standalone consumer needs a
 * real API, not client-side mock state). See CLAUDE.md's "Backends: BFF
 * pattern" section.
 */
export function createApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Bare liveness check -- "the process is up," nothing more. See
  // mfe-pot-employment-insurance-mfe's app.ts for the fuller rationale on
  // why this stays separate from /ready below (same pattern, mirrored
  // here for consistency across all 3 BFFs).
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Real readiness check: a round-trip through this pod's own sessionCache
  // (Redis when REDIS_URL is set, always-succeeds in-memory otherwise --
  // see config.ts). See mfe-pot/TODO.md's "Design principles" section,
  // principle 3/4.
  app.get('/ready', async (_req, res) => {
    try {
      await sessionCache.getJson(sessionCache.buildKey('readiness-probe'));
      res.json({ status: 'ready' });
    } catch (err) {
      res.status(503).json({ status: 'not-ready', error: (err as Error).message });
    }
  });

  app.get('/api/jobs', (_req, res) => {
    res.json(postings);
  });

  app.post('/api/applications', async (req, res) => {
    const { jobId, applicantSub } = req.body as { jobId?: string; applicantSub?: string };
    if (!jobId || !applicantSub) {
      res.status(400).json({ error: 'jobId and applicantSub are required' });
      return;
    }
    if (!getPosting(jobId)) {
      res.status(404).json({ error: `No job posting with id "${jobId}"` });
      return;
    }
    res.status(201).json(await createApplication(jobId, applicantSub));
  });

  app.get('/api/applications', async (req, res) => {
    const applicantSub = req.query['applicantSub'];
    if (typeof applicantSub !== 'string') {
      res.status(400).json({ error: 'applicantSub query parameter is required' });
      return;
    }
    // Denormalize the posting's title/employer onto each application here,
    // at the response-shaping layer, rather than storing them on
    // JobApplication itself -- callers (like dashboard-bff) shouldn't have
    // to make a second round trip to /api/jobs just to show a readable
    // summary.
    const applications = (await getApplications(applicantSub)).map((application) => {
      const posting = getPosting(application.jobId);
      return {
        ...application,
        jobTitle: posting?.title ?? null,
        employer: posting?.employer ?? null,
      };
    });
    res.json(applications);
  });

  // Proves identity (including the SIN custom claim) actually propagated
  // from mock-idp through the browser and was independently verified here
  // -- see mfe-pot's plan doc. Mounted only on this one route, not globally:
  // the domain routes above are single-persona stub data not yet keyed by
  // sub (a bigger, separate scope item).
  app.get(
    '/api/whoami',
    verifyBearerToken({ jwksUrl: mockIdp.jwksUrl, issuer: mockIdp.issuer, audience: mockIdp.audience }),
    whoamiHandler,
  );

  // PoT-only, no auth -- unlocks a repeatable `pnpm demo:reset` (see
  // mfe-pot/TODO.md) by clearing this BFF's own Redis-backed state between
  // local/CI runs and live demos.
  app.post('/api/reset', async (_req, res) => {
    await sessionCache.reset();
    res.status(204).send();
  });

  // Last-resort error handler, not per-call-site try/catch: Express 5
  // (this app's version) auto-forwards a rejected async route handler's
  // promise here, including every sessionCache.getJson/setJson call above
  // -- so a Redis outage (the realistic failure mode, given InMemory-
  // SessionCache never rejects) surfaces as this typed, degraded JSON
  // envelope instead of Express's bare default 500 HTML page. See
  // mfe-pot/TODO.md's "Design principles" section, principle 5.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('job-bank-bff: unhandled request error:', err);
    res.status(503).json({ error: 'Service temporarily unavailable', degraded: true });
  });

  return app;
}
