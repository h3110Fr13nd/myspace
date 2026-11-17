export interface GoogleDrivePermission {
  id: string;
  type: string;
  role: 'owner' | 'organizer' | 'fileOrganizer' | 'writer' | 'commenter' | 'reader';
  emailAddress?: string;
  displayName?: string;
}

/**
 * Extracts the linked Google Drive file id from a resource's metadata.
 * Each Google-backed resource type persists the id under a different key.
 */
export function getGoogleDriveFileIdFromMetadata(metadata: any): string | null {
  if (!metadata) return null;
  const candidate =
    metadata.googleSpreadsheetId ||
    metadata.googleDocId ||
    metadata.googleFormId ||
    metadata.googleSlidesId ||
    metadata.drive_file_id ||
    metadata.fileId ||
    metadata.file_id;
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
}

/**
 * Lists all permissions for a specific Google Drive file.
 */
export async function listGoogleDrivePermissions(
  fileId: string,
  accessToken: string
): Promise<GoogleDrivePermission[]> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId
  )}/permissions?fields=permissions(id,type,role,emailAddress,displayName)`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Google Drive permissions list error (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  return data.permissions || [];
}

/**
 * Shares a Google Drive file with a specific user email.
 */
export async function shareGoogleDriveFile(
  fileId: string,
  emailAddress: string,
  role: 'writer' | 'commenter' | 'reader',
  accessToken: string
): Promise<GoogleDrivePermission> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId
  )}/permissions?sendNotificationEmail=false`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      role,
      type: 'user',
      emailAddress,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Google Drive share error (${res.status}): ${errorText}`);
  }

  return res.json();
}

/**
 * Revokes a permission on a Google Drive file.
 */
export async function revokeGoogleDriveFilePermission(
  fileId: string,
  permissionId: string,
  accessToken: string
): Promise<void> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId
  )}/permissions/${encodeURIComponent(permissionId)}`;

  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Google Drive revoke error (${res.status}): ${errorText}`);
  }
}

/**
 * High-level bridge mirroring OpenFGA relations ('editor' | 'viewer') to Google Drive permissions.
 */
export async function mirrorOpenFgaPermissionToGoogleDrive(
  fileId: string,
  userEmail: string,
  relation: 'owner' | 'editor' | 'viewer',
  accessToken: string
): Promise<GoogleDrivePermission> {
  const role: 'writer' | 'reader' = relation === 'viewer' ? 'reader' : 'writer';
  return shareGoogleDriveFile(fileId, userEmail, role, accessToken);
}
