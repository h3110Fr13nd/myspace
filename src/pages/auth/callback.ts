import type { APIRoute } from 'astro';
import { GET as googleCallbackHandler } from '../api/v1/auth/google/callback';

export const GET: APIRoute = async (context) => {
  return googleCallbackHandler(context);
};
