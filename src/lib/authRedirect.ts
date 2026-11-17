const LOCAL_ORIGIN = 'https://workspace.invalid';

/** Keep a post-auth destination local, even when the query was supplied by a visitor. */
export function safeLocalRedirect(value: string | null | undefined, fallback = '/'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return fallback;
  }

  try {
    const target = new URL(value, LOCAL_ORIGIN);
    if (
      target.origin !== LOCAL_ORIGIN ||
      target.pathname === '/login' ||
      target.pathname === '/register'
    ) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}

/** Return users to the page where they opened auth, not back into auth itself. */
export function authReturnPath(pathname: string, search = ''): string {
  if (pathname === '/login' || pathname === '/register') {
    const redirect = safeLocalRedirect(new URLSearchParams(search).get('redirect'));
    const destination = new URL(redirect, LOCAL_ORIGIN);
    return destination.pathname === '/login' || destination.pathname === '/register' ? '/' : redirect;
  }
  return safeLocalRedirect(`${pathname}${search}`);
}

export function authHref(path: '/login' | '/register', returnTo: string): string {
  return `${path}?redirect=${encodeURIComponent(safeLocalRedirect(returnTo))}`;
}
