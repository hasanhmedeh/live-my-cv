import path from 'node:path';
import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// The Prisma CLI does not read .env on its own; load apps/api/.env wherever it is run from.
// Variables already set in the environment (CI, hosting) win over the file.
config({ path: path.join(import.meta.dirname, '.env'), quiet: true });

// Hosted Postgres often hands out a pooled URL for the app and a direct one for migrations
// (Neon on Vercel sets DATABASE_URL_UNPOOLED); the CLI prefers the direct one.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || undefined;

// `prisma generate` needs no database; everything else does, and Prisma's own error is terse.
if (!url && !process.argv.includes('generate')) {
  console.error('DATABASE_URL is not set. Copy apps/api/.env.example to apps/api/.env and fill it in.');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url },
});
