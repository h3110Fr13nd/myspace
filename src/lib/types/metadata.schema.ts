import { z } from 'zod';

/**
 * Base resource metadata schema shared across all types
 */
export const BaseResourceMetadataSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  socialDescription: z.string().optional(),
  summary: z.string().optional(),
  tags: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
  date: z.union([z.string(), z.date()]).optional(),
  updatedAt: z.union([z.string(), z.date()]).optional(),
  aliases: z.array(z.string()).optional(),
  ogImage: z.string().nullable().optional(),
  slug: z.string().optional(),
  author: z.string().optional(),
  category: z.string().optional(),
  wikilinks: z.array(z.string()).default([]),
  tier: z.enum(['public', 'private', 'free', 'subscriber', 'restricted']).optional(),
}).catchall(z.any());

/**
 * Document & Blog specific metadata
 */
export const DocumentMetadataSchema = BaseResourceMetadataSchema.extend({
  attachedResourceId: z.string().optional(),
  displayMode: z.enum(['inline', 'pdf-embed', 'download']).optional(),
  math: z.boolean().optional(),
  headings: z.array(z.object({
    depth: z.number(),
    text: z.string(),
    slug: z.string(),
  })).optional(),
});

/**
 * PDF specific metadata
 */
export const PdfMetadataSchema = BaseResourceMetadataSchema.extend({
  pageCount: z.number().optional(),
  fileSize: z.number().optional(),
  s3Key: z.string().optional(),
  mimeType: z.literal('application/pdf').default('application/pdf'),
});

/**
 * Canvas specific metadata
 */
export const CanvasMetadataSchema = BaseResourceMetadataSchema.extend({
  nodeCount: z.number().optional(),
  edgeCount: z.number().optional(),
  embeddedResourceId: z.string().optional(),
  position: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number().optional(),
    h: z.number().optional(),
  }).optional(),
  connectedTo: z.array(z.string()).optional(),
});

/**
 * Sheet (tabular data) metadata
 */
export const SheetMetadataSchema = BaseResourceMetadataSchema.extend({
  rowCount: z.number().optional(),
  columnCount: z.number().optional(),
  schemaDefinition: z.record(z.string(), z.any()).optional(),
});

/**
 * Form (dynamic form / questionnaire) metadata
 */
export const FormMetadataSchema = BaseResourceMetadataSchema.extend({
  jsonSchema: z.record(z.string(), z.any()).optional(),
  uiSchema: z.record(z.string(), z.any()).optional(),
  submissionCount: z.number().optional(),
});

/**
 * Todo / Task resource metadata
 */
export const TodoMetadataSchema = BaseResourceMetadataSchema.extend({
  resourceKind: z.literal('todo').default('todo'),
  status: z.enum(['open', 'in-progress', 'done', 'blocked']).default('open'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  assignee: z.string().optional(),
  dueDate: z.union([z.string(), z.date()]).optional(),
});

/**
 * Collection (group of resources) metadata
 */
export const CollectionMetadataSchema = BaseResourceMetadataSchema.extend({
  members: z.array(z.string()).default([]),
  sortOrder: z.enum(['manual', 'date', 'alpha']).default('manual'),
});

/**
 * Image specific metadata
 */
export const ImageMetadataSchema = BaseResourceMetadataSchema.extend({
  width: z.number().optional(),
  height: z.number().optional(),
  mimeType: z.string().optional(),
  s3Key: z.string().optional(),
});

/**
 * Google Drive specific metadata
 */
export const DriveMetadataSchema = BaseResourceMetadataSchema.extend({
  fileId: z.string().optional(),
  mimeType: z.string().optional(),
  driveType: z.enum(['doc', 'sheet', 'form']).optional(),
  googleEmail: z.string().optional(),
});

export type BaseResourceMetadata = z.infer<typeof BaseResourceMetadataSchema>;
export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;
export type PdfMetadata = z.infer<typeof PdfMetadataSchema>;
export type ImageMetadata = z.infer<typeof ImageMetadataSchema>;
export type CanvasMetadata = z.infer<typeof CanvasMetadataSchema>;
export type SheetMetadata = z.infer<typeof SheetMetadataSchema>;
export type FormMetadata = z.infer<typeof FormMetadataSchema>;
export type TodoMetadata = z.infer<typeof TodoMetadataSchema>;
export type CollectionMetadata = z.infer<typeof CollectionMetadataSchema>;
export type DriveMetadata = z.infer<typeof DriveMetadataSchema>;

/**
 * Helper to validate and parse raw metadata based on resource type
 */
export function validateResourceMetadata(type: string, rawData: unknown) {
  switch (type) {
    case 'document':
    case 'blog':
      return DocumentMetadataSchema.safeParse(rawData);
    case 'pdf':
      return PdfMetadataSchema.safeParse(rawData);
    case 'image':
      return ImageMetadataSchema.safeParse(rawData);
    case 'canvas':
      return CanvasMetadataSchema.safeParse(rawData);
    case 'sheet':
      return SheetMetadataSchema.safeParse(rawData);
    case 'form':
      return FormMetadataSchema.safeParse(rawData);
    case 'todo':
      return TodoMetadataSchema.safeParse(rawData);
    case 'collection':
      return CollectionMetadataSchema.safeParse(rawData);
    case 'drive':
    case 'drive_doc':
    case 'drive_sheet':
    case 'drive_form':
      return DriveMetadataSchema.safeParse(rawData);
    default:
      return BaseResourceMetadataSchema.safeParse(rawData);
  }
}
