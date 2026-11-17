# Plan 14: Multi-Provider Authentication, Google OAuth 2.0 & Identity Linking

## Overview
This specification details the multi-provider authentication and identity resolution architecture implemented in the FOSS Content Workspace. It enables users to sign in seamlessly via Google OAuth 2.0 or traditional Email & Password credentials, while automatically resolving and linking accounts sharing verified email addresses.

---

## 1. Core Architecture & Data Model

### `user_identities` Table (Multi-Provider Account Linking)
Enables multiple external authentication providers (Google, GitHub, Passkeys, Email/Password) to link to a single canonical `user:<email>` account without duplicate records or authorization splits.

```sql
CREATE TABLE IF NOT EXISTS user_identities (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(128) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(64) NOT NULL, -- 'google', 'password', 'github', 'passkey'
    provider_account_id VARCHAR(255) NOT NULL, -- Google sub ID or email
    email VARCHAR(255),
    metadata JSONB DEFAULT '{}'::jsonb, -- name, avatar, token expiry, verified flags
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_user_identities_email ON user_identities(email);
```

### `auth_settings` Table (Site-Wide Auth Configuration)
Allows administrators to toggle allowed authentication methods dynamically via database or environment configuration.

```sql
CREATE TABLE IF NOT EXISTS auth_settings (
    id VARCHAR(64) PRIMARY KEY DEFAULT 'default',
    enable_google_oauth BOOLEAN DEFAULT TRUE,
    enable_password_auth BOOLEAN DEFAULT TRUE,
    enable_registration BOOLEAN DEFAULT TRUE,
    auto_link_same_email BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

---

## 2. Identity Resolution & Linking Flows

### Scenario A: New User Signs in with Google
1. User clicks **"Continue with Google"** on `/login` or `/register`.
2. Browser redirects to `https://accounts.google.com/o/oauth2/v2/auth` with `client_id`, `redirect_uri`, and `scope=openid email profile`.
3. Callback (`/api/v1/auth/google/callback`) exchanges authorization code for Google access token and queries `https://www.googleapis.com/oauth2/v2/userinfo`.
4. User record is inserted into `users` (`id = 'user:dummy_mail'`, `password_hash = NULL`, `avatar_url = googleUser.picture`).
5. Personal root vault folder (`folder:alice_example_com_root`) is provisioned in `resources`.
6. OpenFGA relationship tuple `(user:dummy_mail, owner, folder:alice_example_com_root)` is written.
7. Identity row is recorded in `user_identities` (`provider = 'google'`, `provider_account_id = googleSubId`).
8. JWT session cookie (`session_token`) is signed and set (`HttpOnly; SameSite=Lax; Max-Age=604800`).

### Scenario B: Existing Password User Signs in with Google (Matching Email)
1. User previously registered with `dummy_mail` + password.
2. User later clicks **"Continue with Google"** with the same Google email.
3. Callback verifies Google verified email matches existing `user:dummy_mail`.
4. Callback automatically attaches Google identity to `user_identities` without modifying existing `password_hash` or creating duplicate vaults.
5. User logs in with full access to their existing vaults and OpenFGA permissions.

### Scenario C: Google User Sets Password
1. User signed up via Google and wants password access for offline / CLI usage.
2. User visits `/settings/security`, navigates to **"Set Account Password"**.
3. User enters new password (min 6 chars); backend computes `bcrypt.hash(password, 10)` and updates `users.password_hash`.
4. Adds `'password'` row to `user_identities`. User can now log in via either Google or Email/Password.

---

## 3. Implemented Files & API Endpoints

- `src/lib/auth.ts`: Multi-provider helper functions (`getUserIdentities`, `linkProviderIdentity`, `unlinkProviderIdentity`, `setUserPassword`, `getAuthSettings`).
- `src/pages/api/v1/auth/google.ts`: Initiates Google OAuth flow.
- `src/pages/api/v1/auth/google/callback.ts`: Handles code exchange, identity linking, root vault provisioning, and session cookie issuance.
- `src/pages/api/v1/auth/login.ts`: Password authentication with provider discovery and helpful Google account notices.
- `src/pages/api/v1/auth/register.ts`: Standard credential registration with ReBAC vault provisioning.
- `src/pages/api/v1/auth/logout.ts`: Handles GET and POST logout with cookie invalidation and redirect to `/`.
- `src/pages/api/v1/auth/password.ts`: Authenticated endpoint to set or change account password.
- `src/pages/login.astro` & `src/pages/register.astro`: Modernized auth UI with official Google SVG badge, divider, error banners, and glassmorphism styling.
- `src/pages/settings/security.astro`: User security management portal.


---

## 📋 Implementation Status & Audit Checklist

**Status**: ✅ Fully Implemented | **Security Model**: Multi-Provider Identity & OpenFGA Vault Provisioning

- [x] PostgreSQL `user_identities` schema with provider and account mapping
- [x] Google OAuth 2.0 PKCE authentication flow (`src/pages/api/v1/auth/google.ts`, `callback.ts`)
- [x] Email verification validation before account linking (`email_verified: true`)
- [x] Automatic root vault provisioning with OpenFGA owner tuple upon registration
- [x] Credential password authentication with bcrypt hashing (`src/pages/api/v1/auth/login.ts`)
- [x] Password addition for OAuth accounts (`src/pages/api/v1/auth/password.ts`)
- [x] Security and Identity Management portal (`src/pages/settings/security.astro`)
- [ ] Secondary OIDC providers (GitHub, Authentik, Keycloak)
