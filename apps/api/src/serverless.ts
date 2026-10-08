// Entry point for serverless hosts (Vercel Functions): one Nest app per instance, created on the
// first request and reused while the instance stays warm. See apps/web/api/index.js.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
// Nest loads these by name at runtime; importing them here lets the bundler's file tracing see them.
import 'class-transformer';
import 'class-validator';
import { EnvError } from './config/env.js';

let ready: Promise<Express> | undefined;

function app() {
  // Imported lazily so a failing start is caught below rather than crashing the whole function.
  ready ??= import('./create-app.js').then(async ({ createApp }) => {
    const nest = await createApp();
    await nest.init();
    return nest.getHttpAdapter().getInstance() as Express;
  });
  // A failed start shouldn't poison the instance for every later request.
  ready.catch(() => (ready = undefined));
  return ready;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  let express: Express;
  try {
    express = await app();
  } catch (err) {
    console.error(err);
    // Name the settings that need fixing (never their values), so a misconfigured deployment
    // explains itself instead of failing with the host's generic error page.
    const problems = err instanceof EnvError ? err.problems : ['The API failed to start, see the function logs.'];
    res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ statusCode: 503, message: 'The API is not configured correctly', error: 'Service Unavailable', problems }));
    return;
  }
  express(req, res);
}
