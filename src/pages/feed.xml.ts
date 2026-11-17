import type { APIRoute } from 'astro';
import { listAnonymousVisibleResources } from '../lib/permissions';
import { buildResourcePath } from '../lib/resourceUrls';

export const GET: APIRoute = async ({ site, url }) => {
  const baseUrl = site?.toString().replace(/\/$/, '') || url.origin;

  let resources: any[] = [];
  try {
    resources = (await listAnonymousVisibleResources())
      .filter((resource) => resource.type !== 'folder')
      .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime())
      .slice(0, 50);
  } catch (err: any) {
    console.error('[Global RSS Feed] DB error:', err.message);
  }

  const feedTitle = 'FOSS Workspace Global RSS Feed';
  const feedLink = `${baseUrl}/`;
  const selfLink = `${baseUrl}/feed.xml`;
  const feedDesc = 'Latest public notes, articles, research graph nodes, and documents';

  const itemsXml = resources
    .map((r) => {
      const link = `${baseUrl}${buildResourcePath({ id: r.id, type: r.type }, r.path)}`;
      const pubDate = new Date(r.updated_at || r.created_at || Date.now()).toUTCString();
      const desc = r.metadata?.description || r.metadata?.summary || `${r.title} (${r.type})`;
      const author = r.metadata?.author || r.owner_id || 'FOSS Author';

      return `    <item>
      <title><![CDATA[${r.title}]]></title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${pubDate}</pubDate>
      <author><![CDATA[${author}]]></author>
      <description><![CDATA[${desc}]]></description>
    </item>`;
    })
    .join('\n');

  const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title><![CDATA[${feedTitle}]]></title>
    <link>${feedLink}</link>
    <description><![CDATA[${feedDesc}]]></description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${selfLink}" rel="self" type="application/rss+xml"/>
${itemsXml}
  </channel>
</rss>`;

  return new Response(rssXml.trim(), {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
};
