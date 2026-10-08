// Opens Prisma Studio on the development or the production database:
//   pnpm studio:dev   -> apps/api/.env            (port 5555)
//   pnpm studio:prod  -> apps/api/.env.production (port 5556, so both can be open at once)
// Each file only needs DATABASE_URL (DATABASE_URL_UNPOOLED wins when present). Both are gitignored.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseEnv } from 'node:util';

const TARGETS = {
  dev: { file: '.env', port: 5555, missing: 'Run `pnpm dev` once (it creates apps/api/.env), or copy apps/api/.env.example.' },
  prod: {
    file: '.env.production',
    port: 5556,
    missing:
      'Create apps/api/.env.production with the production connection string, e.g.\n' +
      '  DATABASE_URL="postgresql://…"\n' +
      "Copy it from your Neon database's connection details (Vercel → Storage, or the Neon console).",
  },
};

const target = TARGETS[process.argv[2]];
if (!target) {
  console.error('Usage: node scripts/studio.mjs <dev|prod>');
  process.exit(1);
}

const file = path.join(import.meta.dirname, '..', target.file);
if (!existsSync(file)) {
  console.error(`apps/api/${target.file} not found.\n${target.missing}`);
  process.exit(1);
}

const env = parseEnv(readFileSync(file, 'utf8'));
const url = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
if (!url) {
  console.error(`DATABASE_URL is not set in apps/api/${target.file}.`);
  process.exit(1);
}

const where = (() => {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
  } catch {
    return 'an unreadable connection string';
  }
})();

if (process.argv[2] === 'prod') {
  console.log(`\n  ⚠️  PRODUCTION database (${where}). Edits and deletes are live for real players.\n`);
} else {
  console.log(`\n  Development database (${where}).\n`);
}

const prisma = createRequire(import.meta.url).resolve('prisma/build/index.js');
const child = spawn(process.execPath, [prisma, 'studio', '--url', url, '--port', String(target.port)], {
  cwd: path.join(import.meta.dirname, '..'),
  // The Prisma config reads DATABASE_URL too; point it at the same database.
  env: { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url },
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 0));
