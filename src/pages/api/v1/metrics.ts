import type { APIRoute } from 'astro';
import { metricsText } from '../../../lib/observe';
import { authorizeMetricsRequest, metricsDeniedResponse } from '../../../lib/metricsAuth';

export const GET: APIRoute = async ({ request }) => {
  if (!authorizeMetricsRequest(request.headers)) {
    return metricsDeniedResponse();
  }

  try {
    const body = await metricsText();
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (err) {
    return new Response(`metrics scrape failed: ${(err as Error).message}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
};
