import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createResource, extractGoogleFileId, type CreatableResourceType } from '../../../../lib/resourceFactory';
import { json } from '../../../../lib/api';
import { auditContent } from '../../../../lib/acl/auditContent';

/**
 * POST /api/v1/resources/create
 *
 * Unified Resource Creation & Import Ingestion Endpoint.
 * Single contract used by the Sidebar Folder Tree, Command Palette,
 * Global Header quick-create, and Canvas insert flows.
 *
 * Pipeline (delegated to lib/resourceFactory.createResource):
 *   1. Permission Guard  (OpenFGA editor on parent folder)
 *   2. File Scaffolding  (frontmatter / JSON canvas / CSV / binary upload)
 *   3. PostgreSQL Registration
 *   4. OpenFGA owner + hierarchy tuples
 *   5. Meilisearch real-time upsert
 *   6. Return route for client-side navigation
 */

const ResourceTypeSchema = z.enum([
  'folder',
  'document',
  'canvas',
  'sheet',
  'excalidraw',
  'mermaid',
  'pdf',
  'image',
  'google_doc',
  'google_sheet',
]);

const ImportSourceSchema = z.object({
  googleFileId: z.string().optional(),
  url: z.string().optional(),
  fileName: z.string().optional(),
  mimeType: z.string().optional(),
  data: z.string().optional(), // base64 binary payload (pdf / image uploads)
}).optional();

const CreateResourceRequestSchema = z.object({
  title: z.string().min(1, 'Title is required').max(240, 'Title is too long'),
  type: ResourceTypeSchema,
  parent_folder: z.string().optional(),
  space_id: z.string().optional(),
  template: z.string().optional(),
  import_source: ImportSourceSchema,
  is_public: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  summary: z.string().optional(),
}).superRefine((body, ctx) => {
  if ((body.type === 'pdf' || body.type === 'image') && !body.import_source?.data) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['import_source', 'data'],
      message: `A ${body.type === 'pdf' ? 'PDF' : 'image'} file is required.`,
    });
  }

  if (
    (body.type === 'google_doc' || body.type === 'google_sheet') &&
    !extractGoogleFileId(body.import_source?.googleFileId) &&
    !extractGoogleFileId(body.import_source?.url)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['import_source'],
      message: 'Provide a valid Google Docs or Sheets link or file ID.',
    });
  }
});

function toBase64ErrorMessage(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || 'payload'}: ${i.message}`).join('; ');
}

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  const currentUser = locals.user || 'user:anonymous';

  if (currentUser === 'user:anonymous') {
    return json({ error: 'Authentication required to create resources' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CreateResourceRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ error: toBase64ErrorMessage(parsed.error) }, { status: 400 });
  }

  const body = parsed.data;

  // Google URL import: normalize a pasted docs/sheets link into a file id
  const googleFileId =
    extractGoogleFileId(body.import_source?.googleFileId) ||
    extractGoogleFileId(body.import_source?.url) ||
    undefined;

  try {
    const result = await createResource({
      title: body.title,
      type: body.type as CreatableResourceType,
      parentFolder: body.parent_folder,
      spaceId: body.space_id,
      template: body.template,
      isPublic: body.is_public,
      tags: body.tags,
      summary: body.summary,
      currentUser,
      importSource: googleFileId
        ? { ...body.import_source, googleFileId }
        : body.import_source,
    });

    auditContent({
      actor: currentUser,
      action: 'content.create',
      resourceId: result.id,
      resourceType: result.type,
      fields: ['title', 'content'],
      detail: { parentId: result.parentId },
      ip: clientAddress,
    });

    return new Response(
      JSON.stringify({
        success: true,
        id: result.id,
        slug: result.slug,
        type: result.type,
        route: result.route,
        parentId: result.parentId,
        filePath: result.filePath,
        title: result.title,
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    const status = /Forbidden|permissions/i.test(err?.message || '') ? 403 : /not found/i.test(err?.message || '') ? 404 : 500;
    if (status === 500) console.error('[Create Resource API Error]:', err);
    return json({ error: err?.message || 'Failed to create resource' }, { status });
  }
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: 'POST, OPTIONS',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
    },
  });
};
