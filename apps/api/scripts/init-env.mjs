// First run of `pnpm dev`: creates apps/api/.env from .env.example with a freshly generated
// JWT_SECRET, so a new clone starts with one command. An existing .env is never touched, and
// nothing is written when DATABASE_URL already comes from the environment (CI, hosting).
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';

const target = new URL('../.env', import.meta.url);
const example = new URL('../.env.example', import.meta.url);

if (!fs.existsSync(target) && !process.env.DATABASE_URL) {
  const secret = randomBytes(48).toString('base64url');
  const env = fs
    .readFileSync(example, 'utf8')
    .replace(/^# Copy this file.*$/m, '# Local settings, created from .env.example on first run (not committed).')
    .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${secret}`);
  fs.writeFileSync(target, env);
  const url = /^DATABASE_URL=(.*)$/m.exec(env)?.[1] ?? '';
  console.log(`Created apps/api/.env with a new JWT_SECRET. It expects PostgreSQL at ${redact(url)};`);
  console.log('if yours lives elsewhere, edit DATABASE_URL in apps/api/.env and run `pnpm dev` again.');
}

/** postgresql://user:secret@host/db -> postgresql://user:***@host/db */
function redact(url) {
  return url.replace(/(:\/\/[^:/@]+:)[^@]*@/, '$1***@');
}
