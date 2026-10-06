import { defineConfig, type Plugin } from 'vite';
import { renderCvHtml, renderJsonLd } from './seo/render.ts';

// Set SITE_URL in Vercel (Project → Settings → Environment Variables) once you
// attach a custom domain. Falls back to the Vercel production URL, then a default.
const SITE_URL = (
  process.env.SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://hasanhmedeh.vercel.app')
).replace(/\/$/, '');

function seo(): Plugin {
  return {
    name: 'cv-seo',
    transformIndexHtml(html) {
      return html
        .replaceAll('__SITE_URL__', SITE_URL)
        .replace('<!--CV_CONTENT-->', renderCvHtml())
        .replace('<!--JSON_LD-->', `<script type="application/ld+json">${renderJsonLd(SITE_URL)}</script>`);
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

export default defineConfig({
  plugins: [seo()],
  server: { allowedHosts: tunnelHosts },
  preview: { allowedHosts: tunnelHosts },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1300,
  },
});
