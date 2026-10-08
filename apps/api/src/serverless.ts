// Entry point for serverless hosts (Vercel Functions): one Nest app per instance, created on the
// first request and reused while the instance stays warm. See apps/web/api/index.js.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
// Nest loads these by name at runtime; importing them here lets the bundler's file tracing see them.
import 'class-transformer';
import 'class-validator';
import { createApp } from './create-app.js';

let ready: Promise<Express> | undefined;

function app() {
  ready ??= createApp().then(async (nest) => {
    await nest.init();
    return nest.getHttpAdapter().getInstance() as Express;
  });
  // A failed start (e.g. a bad environment) shouldn't poison the instance for every later request.
  ready.catch(() => (ready = undefined));
  return ready;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  (await app())(req, res);
}
