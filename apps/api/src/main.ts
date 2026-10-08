import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvError, type Env } from './config/env.js';

async function bootstrap() {
  // Imported lazily: the environment is validated while the app module loads, and that error
  // should reach the catch below.
  const { createApp } = await import('./create-app.js');
  const app = await createApp();
  app.enableShutdownHooks();

  const port = app.get<ConfigService<Env, true>>(ConfigService).get('PORT', { infer: true });
  await app.listen(port);
  Logger.log(`API ready on http://localhost:${port}/api`, 'Bootstrap');
}

try {
  await bootstrap();
} catch (err) {
  // A stack trace is no help for a missing .env file: print the list of problems and stop.
  if (!(err instanceof EnvError)) throw err;
  console.error(`\n${err.message}\n`);
  process.exit(1);
}
