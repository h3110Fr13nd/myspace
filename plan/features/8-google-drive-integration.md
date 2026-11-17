# Goal: Google Drive Integration & Dynamic Permission Broker

The goal is to seamlessly integrate Google Drive (Docs, Sheets, Forms) into the "Everything is a Resource" (EiaR) architecture, and implement a **programmatic permission broker**. This broker will dynamically grant and revoke Google Drive file permissions to users based on their internal OpenFGA permissions.

This document records the original integration proposal and the current shipped
surface. It remains the plan of record; external Drive permission mirroring is
deferred until linked Google identities, OAuth scopes, revocation behavior, and
the user-facing consent flow are defined.

## User Review Required

> [!IMPORTANT]
> Please review the dynamic permission flow carefully. Modifying Google Drive permissions automatically on behalf of users requires asking them for sensitive OAuth scopes (e.g., `https://www.googleapis.com/auth/drive` or `https://www.googleapis.com/auth/drive.file`).

## Open Questions

> [!WARNING]
> 1. **Google Account Mapping**: To programmatically grant DUMMY_NAME access to DUMMY_NAME's document, we need to know DUMMY_NAME's Google email address. Does our system mandate Google Single Sign-On (SSO), or do we need users to "Link Google Account" in their profile if they signed up via email/password?
> 2. **OAuth Tokens**: Are we using a robust backend queue (like BullMQ or Inngest) to handle permission revocation and OAuth token refreshes? If a user hasn't logged in for a while, their Google refresh token might expire or be revoked.
> 3. **Revocation Strategy**: Revoking Drive permissions when internal OpenFGA permissions change requires listening to OpenFGA tuple changes. Do we want to implement this synchronously during the sharing action, or asynchronously via an event bus?

## Proposed Changes

We will introduce a new `drive:` resource namespace and a background permission broker. 

### 1. Resource Handlers & Viewers (Frontend)

We will introduce new resource types and dedicated viewer islands.

#### [NEW] `src/core/resources/handlers/drive.handler.ts`
- Handles `drive:doc:[id]`, `drive:sheet:[id]`, `drive:form:[id]` URIs.
- Zod schemas for storing Drive metadata (file ID, mime type, owner ID).

#### [NEW] `src/components/resources/viewers/GoogleDocViewer.tsx`
- Renders an iframe pointing to `https://docs.google.com/document/d/[id]/preview`.
- Handles states where the user is logged into the wrong Google account and provides a "Request Access Sync" button.

#### [NEW] `src/components/resources/viewers/GoogleSheetViewer.tsx`
- Renders an iframe pointing to `https://docs.google.com/spreadsheets/d/[id]/edit`.

#### [NEW] `src/components/resources/viewers/GoogleFormViewer.tsx`
- Renders `https://docs.google.com/forms/d/e/[id]/viewform`.

### 2. OAuth & Authentication

#### [NEW] `src/pages/api/v1/auth/google/link.ts`
- OAuth 2.0 flow to link a user's Google Account to their profile.
- Requests `https://www.googleapis.com/auth/drive.file` (or broader) scopes.
- Stores the `access_token`, `refresh_token`, and `google_email` in the PostgreSQL database.

### 3. Dynamic Permission Broker (Backend)

The core logic that bridges OpenFGA with the Google Drive v3 Permissions API.

#### [NEW] `src/core/authz/drivePermissionBroker.ts`
- **`grantAccess(resourceId, targetUserId)`**: 
  - Retrieves the resource owner's Google `refresh_token`.
  - Retrieves the `targetUserId`'s `google_email`.
  - Calls `POST https://www.googleapis.com/drive/v3/files/[id]/permissions` with `role: "reader"`, `type: "user"`, `emailAddress: targetUserId_email`.
- **`revokeAccess(resourceId, targetUserId)`**:
  - Finds the Google Drive `permissionId` for the target user.
  - Calls `DELETE https://www.googleapis.com/drive/v3/files/[id]/permissions/[permissionId]`.

#### [MODIFY] `src/pages/api/v1/resources/share.ts` (or equivalent sharing endpoint)
- When User A shares a Canvas/Resource with User B, we write to OpenFGA.
- **Hook**: After a successful OpenFGA write, we inspect the resources being shared. If any are `drive:` resources, we enqueue a job to the `drivePermissionBroker` to synchronize permissions.

### 4. View-Time "Just-In-Time" Permission Sync

If asynchronous permission granting fails (e.g., token expired), we can perform JIT granting.

#### [NEW] `src/pages/api/v1/resources/drive/[id]/sync-access.ts`
- An endpoint called by the `GoogleDocViewer` if the iframe fails to load or the user clicks "Sync Access".
- Validates the user's OpenFGA read permission on the resource.
- Triggers `drivePermissionBroker.grantAccess` synchronously.

## Verification Plan

### Automated Tests
- Mock the Google Drive API to verify `grantAccess` and `revokeAccess` logic.
- Verify OpenFGA tuple changes correctly identify nested `drive:` resources (e.g., when a Canvas containing a Drive Doc is shared).

### Manual Verification
1. User A links Google Drive and embeds a private Google Doc into a Canvas.
2. User A shares the Canvas with User B.
3. Verify via Google Drive UI that User B's email was added to the document's share list.
4. User B views the Canvas and can successfully see the embedded iframe.
5. User A revokes User B's access to the Canvas.
6. Verify User B's email is removed from the Google Doc's share list.


---

## 📋 Implementation Status & Audit Checklist

**Status**: 🟡 Core listing/import/viewer shipped; external permission sync deferred | **Feature Track**: Google Drive Integration & Sync

- [x] Google Drive API v3 OAuth token integration (`src/lib/google/tokenBroker.ts`)
- [x] Google Drive file listing and file import endpoint (`src/pages/api/v1/vault/google-drive/sync.ts`)
- [x] Dedicated Google Drive Viewer component (`src/components/GoogleDriveViewer.tsx`)
- [x] Drive files ReBAC provisioning (automatic `owner` and `parent_folder` tuples)
- [x] Google Drive Permissions Client (`src/lib/google/permissionsClient.ts`)
- [ ] Background daemon for continuous two-way Drive permission synchronization (deferred: needs linked Google identities, approved Drive scopes, and a defined revocation/consent policy)
