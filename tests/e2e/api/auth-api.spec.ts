import { test, expect } from '../fixtures/auth.fixture';

test.describe('Auth API — contract tests', () => {
  const uid = () => `api-test-${Date.now()}`;

  test('POST /api/v1/auth/register → 201 + session_token cookie', async ({ request }) => {
    const email = `${uid()}@example.com`;
    const res = await request.post('/api/v1/auth/register', {
      data: {
        email,
        password: 'TestPassword123!',
        displayName: 'DUMMY_NAME',
      },
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    expect(body.user?.email).toBe(email);

    const setCookie = res.headers()['set-cookie'];
    expect(setCookie).toContain('session_token');
    expect(setCookie).toContain('HttpOnly');
  });

  test('POST /api/v1/auth/register with duplicate email → 409', async ({ request }) => {
    const res = await request.post('/api/v1/auth/register', {
      data: {
        email: 'dummy_mail', // seeded user
        password: 'TestPassword123!',
        displayName: 'Duplicate',
      },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already exists/i);
  });

  test('POST /api/v1/auth/register with missing fields → 400', async ({ request }) => {
    const res = await request.post('/api/v1/auth/register', {
      data: { email: 'dummy_mail' }, // missing password + displayName
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/v1/auth/login with valid credentials → 200 + cookie', async ({ request }) => {
    const res = await request.post('/api/v1/auth/login', {
      data: {
        email: 'dummy_mail',
        password: 'TestPassword123!',
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.user?.email).toBe('dummy_mail');
    expect(res.headers()['set-cookie']).toContain('session_token');
  });

  test('POST /api/v1/auth/login with wrong password → 401', async ({ request }) => {
    const res = await request.post('/api/v1/auth/login', {
      data: { email: 'dummy_mail', password: 'WrongPassword!' },
    });
    expect(res.status()).toBe(401);
  });

  test('GET /api/v1/auth/me with valid cookie → authenticated user payload', async ({ request }) => {
    // The request fixture shares the browser context cookie jar.
    const loginRes = await request.post('/api/v1/auth/login', {
      data: { email: 'dummy_mail', password: 'TestPassword123!' },
    });
    expect(loginRes.status()).toBe(200);

    const meRes = await request.get('/api/v1/auth/me');
    expect(meRes.status()).toBe(200);
    const body = await meRes.json();
    expect(body.authenticated).toBe(true);
    expect(body.user?.email).toBe('dummy_mail');
  });

  test('GET /api/v1/auth/me without cookie → unauthenticated payload', async ({ request }) => {
    // Use a fresh context with no cookies
    const res = await request.get('/api/v1/auth/me', {
      headers: { Cookie: '' },
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ authenticated: false, user: null });
  });

  test('POST /api/v1/auth/logout → clears session cookie', async ({ request }) => {
    // Login first
    await request.post('/api/v1/auth/login', {
      data: { email: 'dummy_mail', password: 'TestPassword123!' },
    });

    const logoutRes = await request.post('/api/v1/auth/logout');
    expect(logoutRes.status()).toBe(200);

    const setCookie = logoutRes.headers()['set-cookie'] ?? '';
    // Cookie should be cleared (Max-Age=0 or expires in past, or empty value)
    const isCleared =
      setCookie.includes('Max-Age=0') ||
      setCookie.includes('max-age=0') ||
      setCookie.includes('session_token=;') ||
      setCookie.includes('session_token= ;');
    expect(isCleared).toBeTruthy();
  });
});
