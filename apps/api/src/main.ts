import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './config/env.js';
import { createApp } from './create-app.js';

async function bootstrap() {
  const app = await createApp();
  app.enableShutdownHooks();

  const port = app.get<ConfigService<Env, true>>(ConfigService).get('PORT', { infer: true });
  await app.listen(port);
  Logger.log(`API ready on http://localhost:${port}/api`, 'Bootstrap');
}

await bootstrap();
