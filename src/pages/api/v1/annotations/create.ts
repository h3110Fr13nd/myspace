import type { APIRoute } from 'astro';
import { json, apiError } from '../../../../lib/api';
import { query } from '../../../../lib/db';
import { deriveShortId } from '../../../../lib/resourceUrls';
import { grantPublicRead, seedCreatorGrants } from '../../../../lib/acl/projector';

interface CreateNoteRequest {
  pdfId: string;
  title: string;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const currentUser = locals.user || 'user:anonymous';
  if (currentUser === 'user:anonymous') {
    return apiError(401, 'Authentication required');
  }

  let body: CreateNoteRequest;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'Invalid JSON body');
  }

  const { pdfId, title } = body;
  if (!pdfId || !title) {
    return apiError(400, 'pdfId and title are required');
  }

  // Verify PDF exists and user has access
  const pdfRes = await query(
    `SELECT id, metadata FROM resources WHERE id = $1`,
    [pdfId]
  );
  if (pdfRes.rows.length === 0) {
    return apiError(404, 'PDF not found');
  }

  // Check if annotation note already exists
  const existingNote = await query(
    `SELECT id FROM resources 
     WHERE metadata->>'coupledToPdf' = $1 
     AND type = 'document' 
     AND owner_id = $2
     LIMIT 1`,
    [pdfId, currentUser]
  );

  if (existingNote.rows.length > 0) {
    return json({ noteId: existingNote.rows[0].id });
  }

  // Generate note slug and ID
  const pdfMeta = pdfRes.rows[0].metadata || {};
  const pdfTitle = title || pdfMeta.title || 'Untitled PDF';
  const noteSlug = `notes-on-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
  const noteId = `document:demo-vault_${noteSlug}-${deriveShortId(noteSlug)}`;

  // Create the annotation note document
  const noteContent = `# Notes on ${pdfTitle}

> **Source PDF**: [[${pdfId}]]

**Authors**: ${pdfMeta.authors || 'Unknown'}  
**Venue**: ${pdfMeta.venue || 'Unknown'}  
**DOI**: ${pdfMeta.doi || 'N/A'}  
**Year**: ${pdfMeta.year || 'N/A'}

---

## Summary

*Write a brief summary of the paper here...*

## Key Claims & Findings

- 
- 
- 

## Highlights & Quotes

- 
- 

## Questions / Follow-ups

- 
- 

## Connections

- [[${pdfId}]] — Source PDF
`;

  const noteMetadata = {
    coupledToPdf: pdfId,
    entityType: 'annotation',
    tags: ['annotation', 'research-paper'],
    summary: `Annotation notes for "${pdfTitle}"`,
    previewText: `Annotation notes for "${pdfTitle}"`,
    isDraft: false,
    isPrivate: false,
  };

  // Insert the note resource
  await query(
    `INSERT INTO resources (id, type, slug, parent_id, owner_id, path, title, is_public, is_draft, published_at, metadata)
     VALUES ($1, 'document', $2, NULL, $3, $4, $5, TRUE, FALSE, NOW(), $6)
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       metadata = EXCLUDED.metadata`,
    [
      noteId,
      noteSlug,
      currentUser,
      noteId,
      `Notes on ${pdfTitle}`,
      JSON.stringify(noteMetadata),
    ]
  );

  // Update PDF metadata to link back to the annotation note
  await query(
    `UPDATE resources SET metadata = metadata || $2::jsonb WHERE id = $1`,
    [pdfId, JSON.stringify({ coupledNoteId: noteId })]
  );

  // Grant OpenFGA permissions: owner gets full access, PDF viewers get viewer on note
  await seedCreatorGrants(noteId, currentUser);

  // If PDF is public, make note public too
  const pdfPublic = await query(`SELECT is_public FROM resources WHERE id = $1`, [pdfId]);
  if (pdfPublic.rows[0]?.is_public) {
    await grantPublicRead(noteId);
  }

  return json({ noteId });
};