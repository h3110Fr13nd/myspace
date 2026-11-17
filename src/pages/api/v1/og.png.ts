import type { APIRoute } from 'astro';

/**
 * Dynamic OpenGraph & Social Preview Card Generator
 * Generates dynamic 1200x630 social preview cards.
 */
export const GET: APIRoute = async ({ url }) => {
  const title = url.searchParams.get('title') || 'FOSS Content Workspace';
  const category = url.searchParams.get('category') || 'Research Vault';
  const author = url.searchParams.get('author') || 'FOSS Community';
  const tagsParam = url.searchParams.get('tags') || '';
  const tags = tagsParam.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 4);

  // Clean XML escape
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const safeTitle = esc(title.length > 75 ? title.substring(0, 72) + '...' : title);
  const safeCategory = esc(category);
  const safeAuthor = esc(author);

  const tagPills = tags
    .map(
      (t, i) => `
      <g transform="translate(${i * 140}, 0)">
        <rect x="0" y="0" width="130" height="34" rx="17" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
        <text x="65" y="22" fill="#06b6d4" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="600" text-anchor="middle">#${esc(t)}</text>
      </g>
    `
    )
    .join('');

  const svg = `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0b0f19" />
      <stop offset="50%" stop-color="#111827" />
      <stop offset="100%" stop-color="#070a12" />
    </linearGradient>
    <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#6366f1" />
      <stop offset="50%" stop-color="#8b5cf6" />
      <stop offset="100%" stop-color="#06b6d4" />
    </linearGradient>
    <filter id="blurFilter" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="80" />
    </filter>
  </defs>

  <!-- Background Canvas -->
  <rect width="1200" height="630" fill="url(#bg)" />

  <!-- Atmospheric Glow Orbs -->
  <circle cx="150" cy="120" r="180" fill="#6366f1" opacity="0.25" filter="url(#blurFilter)" />
  <circle cx="1050" cy="500" r="220" fill="#06b6d4" opacity="0.2" filter="url(#blurFilter)" />

  <!-- Outer Glass Border Frame -->
  <rect x="40" y="40" width="1120" height="550" rx="24" fill="rgba(17, 24, 39, 0.6)" stroke="rgba(255, 255, 255, 0.12)" stroke-width="2" />

  <!-- Top Brand Banner -->
  <g transform="translate(80, 95)">
    <!-- Logo Icon -->
    <rect x="0" y="0" width="46" height="46" rx="12" fill="url(#glow)" />
    <text x="23" y="32" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="24" font-weight="800" text-anchor="middle">W</text>
    
    <!-- Brand Name -->
    <text x="62" y="24" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="700">FOSS Content Workspace</text>
    <text x="62" y="42" fill="#9ca3af" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13">Astro SSR • OpenFGA ReBAC • Knowledge Graph</text>

    <!-- Category Pill -->
    <g transform="translate(860, 4)">
      <rect x="0" y="0" width="140" height="32" rx="16" fill="rgba(99, 102, 241, 0.2)" stroke="#6366f1" stroke-width="1.5"/>
      <text x="70" y="21" fill="#c7d2fe" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="700" text-anchor="middle">${safeCategory}</text>
    </g>
  </g>

  <!-- Title Text -->
  <g transform="translate(80, 240)">
    <text x="0" y="0" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="44" font-weight="800" letter-spacing="-0.02em">
      ${safeTitle}
    </text>
  </g>

  <!-- Decorative Divider -->
  <line x1="80" y1="440" x2="1120" y2="440" stroke="rgba(255, 255, 255, 0.1)" stroke-width="1" />

  <!-- Footer Metadata & Tags -->
  <g transform="translate(80, 490)">
    <!-- Author Badge -->
    <text x="0" y="20" fill="#9ca3af" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16">
      By <tspan fill="#ffffff" font-weight="700">${safeAuthor}</tspan>
    </text>

    <!-- Tags Row -->
    <g transform="translate(300, 0)">
      ${tagPills}
    </g>
  </g>
</svg>
`;

  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
};
