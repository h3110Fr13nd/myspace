import type { APIRoute } from 'astro';
import { z } from 'zod';
import { query } from '../../../../lib/db';
import { checkPermission } from '../../../../lib/openfga';
import { encodeMeiliId, type MeiliResourceDocument } from '../../../../lib/meilisearch';
import { enqueueIndexOperation } from '../../../../lib/jobs';
import * as fs from 'fs';
import * as path from 'path';
import { json } from '../../../../lib/api';
import { validateResourceMetadata } from '../../../../lib/types/metadata.schema';

const SaveResourceRequestSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  content: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  summary: z.string().optional(),
  is_public: z.boolean().optional(),
  icon: z.unknown().optional(),
}).passthrough();

export const POST: APIRoute = async ({ request, locals }) => {
  const currentUser = locals.user || 'user:anonymous';

  if (currentUser === 'user:anonymous') {
    return json({ error: 'Authentication required to save resources' }, { status: 401 });
  }

  try {
    const payload = await request.json();
    const parsed = SaveResourceRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'payload'}: ${issue.message}`)
        .join('; ');
      return json({ error: details }, { status: 400 });
    }
    const { id, title, content, category, tags: requestedTags, summary, is_public = false, icon } = parsed.data;

    // 1. Fetch current resource to verify existence and check ownership/permissions
    const existingRes = await query('SELECT * FROM resources WHERE id = $1', [id]);
    if (existingRes.rows.length === 0) {
      return json({ error: 'Resource not found' }, { status: 404 });
    }

    const currentDoc = existingRes.rows[0];
    const existingTags = Array.isArray(currentDoc.metadata?.tags) ? currentDoc.metadata.tags : [];
    const tags = requestedTags ?? existingTags;

    // 2. ReBAC Permission Check: User must be owner or have 'editor' permission
    let isAuthorized = false;
    if (currentDoc.owner_id === currentUser) {
      isAuthorized = true;
    } else {
      try {
        isAuthorized = await checkPermission({
          user: currentUser,
          relation: 'editor',
          object: id,
        });
      } catch {
        isAuthorized = false;
      }
    }

    if (!isAuthorized) {
      return json({ error: 'Forbidden: You do not have write permissions for this resource' }, { status: 403 });
    }

    // 3. Extract wikilinks from content [[wikilink]]
    const wikilinkMatches = content ? Array.from(content.matchAll(/\[\[(.*?)\]\]/g)).map((m: any) => m[1].split('|')[0].trim()) : [];
    const uniqueWikilinks = Array.from(new Set(wikilinkMatches));
    const nextSummary = summary ?? currentDoc.metadata?.summary ?? '';
    const nextWikilinks = content !== undefined
      ? uniqueWikilinks
      : Array.isArray(currentDoc.metadata?.wikilinks)
        ? currentDoc.metadata.wikilinks
        : [];
    const validatedFields = validateResourceMetadata(currentDoc.type, {
      tags,
      summary: nextSummary,
      wikilinks: nextWikilinks,
    });
    if (!validatedFields.success) {
      const details = validatedFields.error.issues
        .map((issue) => `${issue.path.join('.') || 'metadata'}: ${issue.message}`)
        .join('; ');
      return json({ error: details }, { status: 400 });
    }

    // 4. Update file on disk if it's a markdown document
    let targetFilePath = currentDoc.metadata?.filePath;
    if (!targetFilePath || !fs.existsSync(targetFilePath)) {
      const catFolder = category || currentDoc.metadata?.category || '01_agentic_ai_systems';
      const slugName = currentDoc.metadata?.slug || id.replace(/^[^:]+:/, '');
      const userVault = currentUser.replace(/^user:/, 'user_');
      targetFilePath = path.join(process.cwd(), 'content', userVault, catFolder, `${slugName}.md`);
    }

    if (content !== undefined) {
      try {
        const dir = path.dirname(targetFilePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // Generate clean markdown frontmatter
        const yamlStr = (v: string) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
        const frontmatter = [
          '---',
          `title: ${yamlStr(title)}`,
          category ? `category: ${yamlStr(category)}` : null,
          summary ? `summary: ${yamlStr(summary)}` : null,
          tags.length > 0 ? `tags: [${tags.map((t: string) => yamlStr(t)).join(', ')}]` : null,
          `is_public: ${Boolean(is_public)}`,
          '---',
          '',
          content,
        ].filter((l) => l !== null).join('\n');

        fs.writeFileSync(targetFilePath, frontmatter, 'utf-8');
      } catch (fileErr: any) {
        console.warn('[Resource Save Warning] Could not write markdown file to disk:', fileErr.message);
      }
    }

    // 5. Update PostgreSQL metadata
    const updatedMetadata = {
      ...(currentDoc.metadata || {}),
      category: category || currentDoc.metadata?.category,
      tags: validatedFields.data.tags,
      summary: validatedFields.data.summary ?? nextSummary,
      ...(icon !== undefined ? { icon } : {}),
      wikilinks: validatedFields.data.wikilinks,
      filePath: targetFilePath,
    };

    await query(
      `UPDATE resources
       SET title = $1,
           metadata = $2,
           is_public = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [title, JSON.stringify(updatedMetadata), Boolean(is_public), id]
    );

    // 6. Update Meilisearch index in background
    try {
      const slug = updatedMetadata.slug || id.replace(/^[^:]+:/, '');
      const doc: MeiliResourceDocument = {
        id: encodeMeiliId(id),
        raw_id: id,
        type: currentDoc.type,
        title,
        path: currentDoc.path || '',
        category: updatedMetadata.category || 'Vault Note',
        summary: updatedMetadata.summary,
        content: content || '',
        tags: updatedMetadata.tags,
        aliases: updatedMetadata.aliases || [],
        owner_id: currentDoc.owner_id,
        is_public: Boolean(is_public),
        slug,
        updated_at: new Date().toISOString(),
      };
      await enqueueIndexOperation({ indexOperation: 'add', meiliDoc: doc });
    } catch (meiliErr: any) {
      console.warn('[Resource Save Warning] Meilisearch index update failed:', meiliErr.message);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Resource saved successfully',
        id,
        title,
        updated_at: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    console.error('[Resource Save API Error]:', err.message);
    return json({ error: err.message }, { status: 500 });
  }
};
