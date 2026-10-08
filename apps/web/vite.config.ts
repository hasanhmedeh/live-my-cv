import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const page = (file: string) => fileURLToPath(new URL(file, import.meta.url));

// Set SITE_URL in Vercel (Project → Settings → Environment Variables) once you
// attach a custom domain. Falls back to the Vercel production URL, then a default.
const SITE_URL = (
  process.env.SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://hasanhmedeh.vercel.app')
).replace(/\/$/, '');

function seo(): Plugin {
  return {
    name: 'seo',
    transformIndexHtml(html) {
      return html.replaceAll('__SITE_URL__', SITE_URL);
    },
    generateBundle() {
      const today = new Date().toISOString().slice(0, 10);
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${SITE_URL}/terms</loc>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>${SITE_URL}/privacy</loc>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
</urlset>
`,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
      });
    },
  };
}

// Let ngrok tunnels reach the dev/preview server (a leading dot allows every subdomain,
// so new random tunnel URLs keep working without editing this file).
const tunnelHosts = ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.io'];

// The accounts API (apps/api) runs beside the dev server; proxying it keeps the browser on one
// origin, so the session cookie just works.
const proxy = {
  '/api': { target: 'http://localhost:3000', changeOrigin: true },
};

export default defineConfig({
  plugins: [seo()],
  // `open` launches the browser on `pnpm dev` (BROWSER=none skips it)
  server: { allowedHosts: tunnelHosts, open: true, proxy },
  preview: { allowedHosts: tunnelHosts, proxy },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1300,
    // The game plus the legal pages (served as /terms and /privacy thanks to cleanUrls in vercel.json)
    rolldownOptions: {
      input: { index: page('./index.html'), terms: page('./terms.html'), privacy: page('./privacy.html') },
    },
  },
});
