import type { APIRoute } from 'astro';
import { listAnonymousVisibleResources } from '../lib/permissions';
import { buildResourcePath } from '../lib/resourceUrls';

export const GET: APIRoute = async ({ site, url }) => {
  const baseUrl = site?.toString().replace(/\/$/, '') || url.origin;

  let resources: any[] = [];
  try {
    resources = (await listAnonymousVisibleResources())
      .filter((resource) => resource.type !== 'folder');
  } catch (err: any) {
    console.error('[Sitemap] Database error:', err.message);
  }

  const staticUrls = [
    {
      loc: `${baseUrl}/`,
      changefreq: 'daily',
      priority: '1.0',
      lastmod: new Date().toISOString().split('T')[0],
    },
    {
      loc: `${baseUrl}/tags`,
      changefreq: 'daily',
      priority: '0.9',
      lastmod: new Date().toISOString().split('T')[0],
    },
    {
      loc: `${baseUrl}/blogs/demo`,
      changefreq: 'daily',
      priority: '0.8',
      lastmod: new Date().toISOString().split('T')[0],
    },
  ];

  const resourceUrls = resources.map((r) => {
    const loc = `${baseUrl}${buildResourcePath({ id: r.id, type: r.type }, r.path)}`;
    const dateVal = r.updated_at || r.created_at || new Date();
    const lastmod = new Date(dateVal).toISOString().split('T')[0];

    let priority = '0.7';
    if (r.type === 'blog' || r.type === 'document') priority = '0.8';
    if (r.type === 'pdf') priority = '0.6';

    return `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`;
  });

  const staticXml = staticUrls
    .map(
      (u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
    )
    .join('\n');

  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticXml}
${resourceUrls.join('\n')}
</urlset>`;

  return new Response(sitemapXml.trim(), {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
};
