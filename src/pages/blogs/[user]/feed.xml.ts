import type { APIRoute } from 'astro';
import { listAnonymousVisibleResources } from '../../../lib/permissions';

export const GET: APIRoute = async ({ params, site, url }) => {
  const { user = 'demo' } = params;
  const ownerId = user.includes(':') ? user : `user:${user}`;
  const baseUrl = site?.toString().replace(/\/$/, '') || url.origin;

  let resources: any[] = [];
  try {
    resources = (await listAnonymousVisibleResources())
      .filter((resource) => resource.owner_id === ownerId && resource.type !== 'folder')
      .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime())
      .slice(0, 50);
  } catch (err: any) {
    console.error('[RSS Feed] DB error:', err.message);
  }

  const feedTitle = `@${user}'s Vault RSS Feed`;
  const feedLink = `${baseUrl}/blogs/${user}`;
  const selfLink = `${baseUrl}/blogs/${user}/feed.xml`;
  const feedDesc = `Public notes, articles, and research graph resources published by ${ownerId}`;

  const itemsXml = resources
    .map((r) => {
      const docParam = encodeURIComponent(r.id);
      const link = `${baseUrl}/?doc=${docParam}`;
      const pubDate = new Date(r.updated_at || r.created_at || Date.now()).toUTCString();
      const desc = r.metadata?.description || r.metadata?.summary || `${r.title} (${r.type})`;
      const category = r.metadata?.category || r.type;

      return `    <item>
      <title><![CDATA[${r.title}]]></title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${pubDate}</pubDate>
      <description><![CDATA[${desc}]]></description>
      <category><![CDATA[${category}]]></category>
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
