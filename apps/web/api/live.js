// Vercel Function for GET /api/live, the game's live updates (Server-Sent Events). The same Nest
// app as api/index.js, in a function of its own: a stream stays open for minutes (the API closes
// it after 4, and the browser reconnects), while every other request keeps the short time limit.
export { default } from '@funfair/api/serverless';
