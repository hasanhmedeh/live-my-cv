// Appoints or dismisses staff: the accounts that can open The Ringmaster's Office (/ringmaster).
//   pnpm staff:appoint <email>          make an account staff     (apps/api/.env)
//   pnpm staff:dismiss <email>          make it a player again
//   pnpm staff:list                     who is staff
// Add --prod to run against apps/api/.env.production instead (the file `pnpm studio:prod` uses).
// The account has to exist: sign up in the fair first. Each change is written to the logbook.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import pg from 'pg';

const args = process.argv.slice(2);
const prod = args.includes('--prod');
const [command, rawEmail] = args.filter((a) => a !== '--prod');
const email = rawEmail?.trim().toLowerCase();

if (!['appoint', 'dismiss', 'list'].includes(command) || (command !== 'list' && !email)) {
  console.error('Usage: pnpm staff:appoint <email> | pnpm staff:dismiss <email> | pnpm staff:list   (add --prod for production)');
  process.exit(1);
}

const file = path.join(import.meta.dirname, '..', prod ? '.env.production' : '.env');
if (!existsSync(file)) {
  console.error(`apps/api/${path.basename(file)} not found.${prod ? ' Create it with the production DATABASE_URL (see scripts/studio.mjs).' : ' Run `pnpm dev` once to create it.'}`);
  process.exit(1);
}
const env = { ...parseEnv(readFileSync(file, 'utf8')), ...(prod ? {} : process.env) };
const url = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
if (!url) {
  console.error(`DATABASE_URL is not set in apps/api/${path.basename(file)}.`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  if (prod) console.log(`\n  ⚠️  PRODUCTION database (${new URL(url).hostname}).\n`);

  if (command === 'list') {
    const { rows } = await client.query(`SELECT email, username, created_at FROM users WHERE role = 'admin' ORDER BY created_at`);
    if (!rows.length) console.log('No staff yet. Appoint someone with `pnpm staff:appoint <email>`.');
    for (const r of rows) console.log(`  🎩 ${r.username} <${r.email}>`);
  } else {
    const role = command === 'appoint' ? 'admin' : 'player';
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT id, username, role FROM users WHERE email = $1 FOR UPDATE`, [email]);
    if (!rows.length) {
      await client.query('ROLLBACK');
      console.error(`No account with the email ${email}. Sign up in the fair first.`);
      process.exitCode = 1;
    } else if (rows[0].role === role) {
      await client.query('ROLLBACK');
      console.log(`${rows[0].username} <${email}> is already ${role === 'admin' ? 'staff' : 'a player'}.`);
    } else {
      // the columns are UTC timestamps without a zone (as Prisma writes them), whatever the server's time zone
      await client.query(`UPDATE users SET role = $1, updated_at = now() AT TIME ZONE 'UTC' WHERE id = $2`, [role, rows[0].id]);
      await client.query(
        `INSERT INTO admin_actions (id, actor_id, actor_name, action, target, details, created_at)
         VALUES (gen_random_uuid()::text, NULL, 'cli', 'user.role', $1, $2, now() AT TIME ZONE 'UTC')`,
        [email, JSON.stringify({ before: { role: rows[0].role }, after: { role } })],
      );
      await client.query('COMMIT');
      console.log(
        role === 'admin'
          ? `🎩 ${rows[0].username} <${email}> is now staff. Their account card in the fair links to The Ringmaster's Office (/ringmaster).`
          : `${rows[0].username} <${email}> is a player again.`,
      );
    }
  }
} finally {
  await client.end();
}
