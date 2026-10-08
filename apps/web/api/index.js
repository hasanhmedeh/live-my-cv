// Vercel Function: serves the NestJS API (apps/api) on this site's own origin, so the session
// cookie stays first-party. vercel.json rewrites every /api/* request here, and Nest routes it
// by the original path. Built by `nest build` before the site, see vercel.json's buildCommand.
export { default } from '@funfair/api/serverless';
