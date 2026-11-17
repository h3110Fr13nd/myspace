# Plan 26: Deep Google Docs & Google Sheets Integration Architecture

> **Document**: Google Workspace Bi-Directional Synchronization & Live Embedding Specification  
> **Location**: `plan/initial/26-google-docs-and-sheets-deep-integration.md`  
> **Status**: Approved Architectural Plan  
> **Builds On**: [Plan 8 (Google Drive Integration)](8-google-drive-integration.md), [Plan 14 (Multi-Provider Auth)](14-multi-provider-auth-account-linking.md), [Plan 25 (Next-Gen WYSIWYG Component Editor)](25-next-gen-wysiwyg-component-editor-architecture.md)  
> **Core Primitives**: Google Drive v3 API, Google Sheets v4 API, Google Docs v1 API, OAuth 2.0 Token Broker, OpenFGA Permission Sync, MinIO/R2 Snapshot Caching

---

## 🌐 1. Executive Summary & Objective

The workspace already features Google OAuth account linking and basic Google Drive file listing. However, users require **seamless, deep integration of Google Sheets and Google Docs**:
1. **Live Visual In-Editor Embedding**: Effortlessly embed and interact with Google Sheets and Google Docs inside our Next-Gen WYSIWYG editor via `/google-sheet` and `/google-doc`.
2. **Tabular Data Ingestion (Google Sheets API v4)**: Ingest Google Sheets into structured JSON/Bases datasets, enabling filtering, querying, and charting inside notes.
3. **Document Conversion & Two-Way Sync (Google Docs API v1)**: Bi-directional conversion between Google Docs AST and Obsidian Flavored Markdown (OFM) / TipTap ProseMirror AST.
4. **Automated OAuth Token Broker**: Transparently handle token refreshes using stored `refresh_token`s without forcing user re-authentication.
5. **ReBAC Permission Mirroring**: Automatically synchronize OpenFGA `viewer` and `editor` relations to Google Drive file permissions via the Google Drive Permissions API.

---

## 🏛️ 2. Architectural Topology

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 GOOGLE WORKSPACE INTEGRATION TOPOLOGY                                  │
│                                                                                                        │
│  [Next-Gen WYSIWYG Editor]             [Bases Query Engine]                [Spatial Canvas]             │
│        │                                       │                                   │                   │
│        │ /google-sheet or /google-doc           │ Query #tag with Sheet data        │ Google Node Card  │
│        ▼                                       ▼                                   ▼                   │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                 Astro Backend API & Token Broker                                 │  │
│  │                                                                                                  │  │
│  │  1. Token Broker (src/lib/auth/googleTokenBroker.ts):                                             │  │
│  │     - Checks token expiry in user_identities.metadata                                            │  │
│  │     - Automatically exchanges refresh_token with https://oauth2.googleapis.com/token             │  │
│  │                                                                                                  │  │
│  │  2. Google Drive / Sheets / Docs Service Layer (src/lib/google/):                                │  │
│  │     - sheetsClient.ts: Ingests sheet ranges (values.batchGet) -> JSONB array                     │  │
│  │     - docsClient.ts: Ingests document AST -> Markdown AST                                        │  │
│  │     - permissionsClient.ts: Mirrors OpenFGA tuples to Google Drive file permissions              │  │
│  └───────────────────────────────────┬───────────────────────────────────┬──────────────────────────┘  │
│                                      │                                   │                             │
│                                      ▼                                   ▼                             │
│                  ┌──────────────────────────────────────┐  ┌──────────────────────────────────────┐    │
│                  │ Google Workspace APIs (Cloud)        │  │ Local Persistence & Cache            │    │
│                  │  - Drive API v3 (Files, Permissions) │  │  - PostgreSQL (Metadata & JSONB)     │    │
│                  │  - Sheets API v4 (Spreadsheets)      │  │  - MinIO / R2 (Cached Snapshots)     │    │
│                  │  - Docs API v1 (Document Content)    │  │  - OpenFGA (ReBAC Tuples)            │    │
│                  └──────────────────────────────────────┘  └──────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔌 3. Core Capabilities & Primitives

### 3.1 Automated Token Broker (`googleTokenBroker.ts`)
Users shouldn't be interrupted with login dialogs when their access token expires (typically after 60 minutes):
```typescript
export async function getValidGoogleAccessToken(userId: string): Promise<string> {
  const identity = await queryUserGoogleIdentity(userId);
  if (!identity || !identity.metadata?.refresh_token) {
    throw new Error('Google account not linked or missing refresh token');
  }

  const { access_token, refresh_token, expiry_date } = identity.metadata;

  // If token is valid for at least 5 more minutes, use it
  if (expiry_date && Date.now() < expiry_date - 300000) {
    return access_token;
  }

  // Refresh token with Google OAuth 2.0
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  const refreshed = await tokenRes.json();
  const newAccessToken = refreshed.access_token;
  const newExpiry = Date.now() + (refreshed.expires_in * 1000);

  // Persist new token in user_identities
  await updateUserIdentityMetadata(userId, 'google', {
    ...identity.metadata,
    access_token: newAccessToken,
    expiry_date: newExpiry,
  });

  return newAccessToken;
}
```

### 3.2 Google Sheets API v4: Tabular Ingestion & Bases Integration
- **Range Ingestion**: Query specific sheets or ranges:
  `GET https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values/{range}`
- **Structured Storage**:
  Converts rows into JSON objects using the first row as column headers:
  ```json
  [
    { "Task": "Edge Worker Collab", "Owner": "DUMMY_NAME", "Status": "Done", "Estimate": "2d" },
    { "Task": "WYSIWYG Editor", "Owner": "DUMMY_NAME", "Status": "In Progress", "Estimate": "1d" }
  ]
  ```
- **Bases Query Link**:
  Allows writing a Bases query that joins local research notes with live Google Sheets data:
  ````markdown
  ```bases
  from: google:1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
  range: SprintPlan!A1:D20
  layout: table
  filter: Status = 'In Progress'
  ```
  ````

### 3.3 Google Docs API v1: Bi-Directional Markdown Conversion
- **Import (Google Docs $\rightarrow$ Markdown)**:
  Parses the structural elements returned by `GET https://docs.googleapis.com/v1/documents/{documentId}`:
  - Paragraphs with named styles (`HEADING_1`, `HEADING_2`, `NORMAL_TEXT`) $\rightarrow$ `#`, `##`, paragraphs.
  - Text style runs with bold, italic, strikethrough, links $\rightarrow$ `**bold**`, `*italic*`, `[text](url)`.
  - Bulleted and numbered lists $\rightarrow$ `- item`, `1. item`.
  - Tables $\rightarrow$ GFM Markdown tables.
- **Export (Markdown $\rightarrow$ Google Docs)**:
  Uses `documents.batchUpdate` with `InsertTextRequest`, `UpdateTextStyleRequest`, and `UpdateParagraphStyleRequest` to generate clean Google Docs.

### 3.4 In-Editor Live Embedding (`GoogleResourceNode.tsx`)
In the Next-Gen WYSIWYG editor:
- **Slash Commands**:
  - `/google-sheet`: Inserts a Google Sheet card with options to paste URL or browse connected Google Drive sheets.
  - `/google-doc`: Inserts a Google Doc card with preview and direct link.
- **Visual Modes**:
  - **Embedded Iframe**: Live interactive spreadsheet/doc with native scroll and formulas.
  - **Snapshot Card**: Shows document title, last modified timestamp, and "Open in Google Workspace" button.
  - **Cell Range Table**: Renders ingested data as a clean glassmorphic table.

### 3.5 ReBAC Permission Mirroring
When a resource is shared in our workspace via OpenFGA:
- User A grants `user:dummy_mail` the `editor` role on a document linked to a Google Drive file.
- Astro webhook triggers `permissionsClient.ts`:
  ```typescript
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role: 'writer',
      type: 'user',
      emailAddress: colleagueEmail,
    }),
  });
  ```
- Conversely, revoking access in OpenFGA removes the permission in Google Drive.

---

## 🛠️ 4. Proposed Implementation Roadmap

### Phase 1: Token Broker & Extended OAuth Scopes
1. Add `https://www.googleapis.com/auth/spreadsheets` and `https://www.googleapis.com/auth/documents` to Google OAuth request scopes in [`src/pages/api/v1/auth/google.ts`](file:///home/user/workspace/src/pages/api/v1/auth/google.ts).
2. Implement `src/lib/auth/googleTokenBroker.ts` for automatic refresh token handling.

### Phase 2: Google Sheets & Docs Backend Endpoints
1. Implement `src/pages/api/v1/google/sheets/values.ts`: Fetch range values formatted as JSON.
2. Implement `src/pages/api/v1/google/docs/import.ts`: Ingest Google Doc AST and return Markdown.
3. Implement `src/pages/api/v1/google/docs/export.ts`: Create or update Google Doc from Markdown.

### Phase 3: Editor & Bases Integration
1. Wire `GoogleResourceNode.tsx` to automatically suggest files from `/api/v1/vault/google-drive/files`.
2. Connect `BasesNode.tsx` to support `from: google:{fileId}` data sources.

### Phase 4: ReBAC Permission Synchronization
1. Hook `ShareModal.tsx` OpenFGA tuple changes to Google Drive Permissions API (`/drive/v3/files/{id}/permissions`).

---

## 🧪 5. Verification Plan

1. **OAuth Scopes**: Log in via Google OAuth, confirm scopes granted include Sheets and Docs.
2. **Token Refresh**: Artificially expire the `expiry_date` in PostgreSQL and verify the next API call refreshes the token without error.
3. **Sheets Ingestion**: Call `/api/v1/google/sheets/values` with a test sheet ID and verify clean JSON output.
4. **Editor Embedding**: Insert `/google-sheet`, paste URL, and verify the live interactive iframe and metadata card render smoothly.


---

## 📋 Implementation Status & Audit Checklist

**Status**: 🔭 Future Roadmap (Phases 1-2 Active) | **Track**: Google Workspace Bi-Directional Sync

- [x] Google OAuth Token Broker with auto-refresh (`tokenBroker.ts`)
- [x] Google Sheets API v4 raw tabular data ingestion (`sheetsClient.ts`, `SheetGrid.tsx`)
- [x] Google Drive file permissions inspection and sharing (`permissionsClient.ts`)
- [ ] Bi-directional Google Docs AST to Markdown synchronization
- [ ] OpenFGA ReBAC automatic permission mirroring daemon to Google Drive
