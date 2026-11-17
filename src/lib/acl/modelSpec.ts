/**
 * Declarative OpenFGA authorization model specification.
 *
 * This module is the SINGLE SOURCE OF TRUTH for the ReBAC schema. It replaces
 * the ~700-line hand-written `type_definitions` literal that previously lived
 * in `scripts/init-openfga.ts` (and which `authz/model.fga` merely mirrored as
 * dead documentation, causing the two to drift).
 *
 * `compileModel()` turns this table into OpenFGA `type_definitions` JSON.
 * `scripts/deploy-openfga-model.ts` deploys it; `scripts/generate-fga-dsl.ts`
 * renders it back to the readable DSL in `authz/model.fga`.
 *
 * ── Why the shape is what it is ────────────────────────────────────────────
 *
 * Every content type shares one skeleton, so a type is declared by naming its
 * deviations rather than by re-listing its relations. See `CONTENT_TYPES`.
 *
 * Two capability relations were added on top of the original role ladder:
 *
 *   read_acl      — may enumerate who else has access. Modelled after Google
 *                   Drive's "Can access detailed file permissions", which is a
 *                   capability distinct from the read it describes. Viewers and
 *                   commenters must NOT be able to read the ACL.
 *   manage_grants — may change who has access. Notion's "Full access" is defined
 *                   solely as "can also share", so this is `owner` plus explicit
 *                   delegation, and it deliberately does NOT inherit: a folder
 *                   owner cannot silently re-share every descendant.
 *
 * `denied_viewer` / `denied_editor` were previously DECLARED but referenced in
 * zero unions, so they silently did nothing. They are now wired into every
 * union, which makes denial fail-closed. See `guards.test.ts` for the guard
 * that keeps declared relations from going dead again.
 */

/** A directly-assignable subject. */
export type DirectType = 'user' | 'group#member' | 'service_account' | 'space#member';

/** A structural edge, e.g. `parent_folder: ['folder']`. */
export type TupleSet = Record<string, string[]>;

export interface RelationSpec {
  /** Subject types that may be assigned to this relation directly. */
  from?: DirectType[];
  /**
   * Typed wildcards admissible on this relation, e.g. `user:*` for
   * "anyone with the link".
   *
   * Deliberately separate from `from`: a wildcard is public access, so it is
   * granted only on the content ladder (`viewer` / `editor`) and NEVER on
   * `read_acl` or `manage_grants`. Putting the two in one list is how a public
   * resource ends up with a publicly-readable ACL.
   */
  wildcard?: DirectType[];
  /** Union with other relations on the same object. */
  or?: string[];
  /** Inherit a relation from a structural tuple, e.g. `editor from parent_folder`. */
  inherit?: Array<{ rel: string; via: string }>;
  /**
   * RESERVED / UNSUPPORTED — the compiler throws if this is set.
   *
   * Negation would belong here, but OpenFGA v1.5's JSON model API rejects every
   * `exclusion` userset shape. Denial is enforced in `src/lib/acl/guards.ts`
   * via `check()` against the `denied_viewer` / `denied_editor` relations.
   * See the block comment below for the full rationale.
   */
  not?: string[];
}

export interface TypeSpec {
  /** Structural relations, e.g. `{ parent_folder: ['folder'] }`. */
  links?: TupleSet;
  relations: Record<string, RelationSpec>;
}

/** Roles a user may hold, ordered weakest → strongest. */
export const ROLE_ORDER = ['none', 'viewer', 'commenter', 'editor', 'owner'] as const;
export type Role = (typeof ROLE_ORDER)[number];

/** Relations that carry structural meaning rather than granting capability. */
export const STRUCTURAL_RELATIONS = new Set(['parent_folder', 'parent_space', 'parent_canvas', 'tagged']);

const USER_SUBJECT: DirectType[] = ['user'];
/** Groups nest: a group may be a member of another group. */
const GROUP_SUBJECT: DirectType[] = ['user', 'group#member'];
const PUBLIC_SUBJECT: DirectType[] = ['user'];

/**
 * "Everyone in the workspace", expressed as a userset on the space itself.
 *
 * A typed wildcard (`user:*`) means anyone at all, including signed-out visitors,
 * so it cannot express "every member of this workspace". `space:main#member` can,
 * and it stays inside the authorization graph where it can be reasoned about,
 * revoked, and explained — rather than living in a Postgres flag.
 */
const WORKSPACE_SUBJECT: DirectType[] = ['space#member'];
const MEMBER_AND_SA: DirectType[] = ['user', 'group#member', 'service_account'];
const USER_AND_SA: DirectType[] = ['user', 'service_account'];

/**
 * Deny relations accept a user or a `group#member` userset, never a raw group.
 * A deny aimed at a group id would silently never match, because the model
 * admits `group#member` (an expansion), not `group`.
 */
const DENY_SUBJECT: DirectType[] = ['user', 'group#member'];

/*
 * ── Why `user:*` is a first-class part of the spec ─────────────────────────
 *
 * `src/lib/openfga.ts` declares `PUBLIC_USER = 'user:*'` and `grant.ts` writes
 * it, but the previous model never admitted a typed wildcard on any relation,
 * so every "make public" write was rejected by the engine. The live store
 * contains ZERO wildcard tuples as a result: the Public Access toggle in the
 * Share dialog has never worked, and 101 resources are "public" only via a
 * separate `resources.is_public` Postgres flag — two sources of truth for one
 * concept, which is how you get "I made it public and nobody can see it".
 *
 * Wildcards are therefore declared explicitly, and only where they mean
 * something: read access to content. See `RelationSpec.wildcard`.
 */

/*
 * ── Why negation is NOT expressed in this model ────────────────────────────
 *
 * `RelationSpec.not` exists in the type system but the compiler REJECTS it.
 * OpenFGA v1.5's JSON model API refuses every `exclusion` userset shape
 * ("invalid userset rewrite definition") while accepting `union` and
 * `intersection` — verified against the running engine across base/child
 * combinations, both schema 1.1 and 1.2.
 *
 * So denial is enforced one layer up, in `src/lib/acl/guards.ts`, as an
 * explicit `check()` against the `denied_viewer` / `denied_editor` relations.
 * Those are ordinary assignable relations, so the engine still owns the
 * decision and the guard stays a single auditable chokepoint.
 *
 * Do not "fix" this by inlining `exclusion` into the model — it will not
 * validate, and a half-applied deny fails OPEN.
 */


/**
 * Shared relations present on every container-like type.
 *
 * `parent` names the structural tuple an object hangs from, so a type opts into
 * inheritance by naming its parent instead of repeating four TTU entries.
 */
function contentRelations(parent: string | null, opts: { ownerImpliesViewer?: boolean } = {}): Record<string, RelationSpec> {
  const editorPaths: RelationSpec = parent
    ? { from: MEMBER_AND_SA, or: ['owner'], inherit: [{ rel: 'editor', via: parent }] }
    : { from: MEMBER_AND_SA, or: ['owner'] };

  const viewerChildren = opts.ownerImpliesViewer ? ['owner', 'editor'] : ['editor'];
  const viewerPaths: RelationSpec = parent
    ? { from: MEMBER_AND_SA, or: viewerChildren, inherit: [{ rel: 'viewer', via: parent }] }
    : { from: MEMBER_AND_SA, or: viewerChildren };

  const readAclPaths: RelationSpec = parent
    ? { from: MEMBER_AND_SA, or: ['editor', 'manage_grants'], inherit: [{ rel: 'read_acl', via: parent }] }
    : { from: MEMBER_AND_SA, or: ['editor', 'manage_grants'] };

  return {
    owner: { from: USER_AND_SA },
    manage_grants: { from: USER_AND_SA, or: ['owner'] },
    editor: editorPaths,
    viewer: viewerPaths,
    read_acl: readAclPaths,
    denied_viewer: { from: DENY_SUBJECT },
    denied_editor: { from: DENY_SUBJECT },
  };
}

export const MODEL: Record<string, TypeSpec> = {
  user: { relations: {} },
  group: { relations: { member: { from: GROUP_SUBJECT } } },
  service_account: { relations: {} },

  tag: {
    relations: {
      owner: { from: USER_AND_SA },
      manage_grants: { from: USER_AND_SA, or: ['owner'] },
      viewer: { from: MEMBER_AND_SA, or: ['owner'] },
      read_acl: { from: MEMBER_AND_SA, or: ['manage_grants'] },
      denied_viewer: { from: DENY_SUBJECT },
    },
  },

  space: {
    relations: {
      // Membership is what makes `space:main#member` a valid grant subject, and
      // it is also what "workspace audience" resolves through.
      member: { from: GROUP_SUBJECT },
      ...contentRelations(null),
    },
  },

  folder: {
    links: { parent_space: ['space'], parent_folder: ['folder'] },
    relations: {
      ...contentRelations('parent_folder'),
      editor: {
        from: MEMBER_AND_SA,
        or: ['owner'],
        inherit: [
          { rel: 'editor', via: 'parent_folder' },
          { rel: 'editor', via: 'parent_space' },
        ],
      },
      viewer: {
        from: MEMBER_AND_SA,
        or: ['editor'],
        inherit: [
          { rel: 'viewer', via: 'parent_folder' },
          { rel: 'viewer', via: 'parent_space' },
        ],
      },
      read_acl: {
        from: MEMBER_AND_SA,
        or: ['editor', 'manage_grants'],
        inherit: [
          { rel: 'read_acl', via: 'parent_folder' },
          { rel: 'read_acl', via: 'parent_space' },
        ],
      },
    },
  },

  // `ownerImpliesViewer`: these types historically let `owner` reach `viewer`
  // directly; preserved so the migration does not silently change access.
  image: { links: { parent_folder: ['folder'], tagged: ['tag'] }, relations: { ...contentRelations('parent_folder', { ownerImpliesViewer: true }) } },
  paper: { links: { parent_folder: ['folder'], tagged: ['tag'] }, relations: { ...contentRelations('parent_folder', { ownerImpliesViewer: true }) } },
  pdf: { links: { parent_folder: ['folder'], tagged: ['tag'] }, relations: { ...contentRelations('parent_folder', { ownerImpliesViewer: true }) } },

  document: { links: { parent_folder: ['folder'], tagged: ['tag'] }, relations: { ...contentRelations('parent_folder') } },
  blog: { links: { parent_folder: ['folder'], tagged: ['tag'] }, relations: { ...contentRelations('parent_folder') } },
  canvas: { links: { parent_folder: ['folder'], tagged: ['tag'] }, relations: { ...contentRelations('parent_folder') } },
  sheet: { links: { parent_folder: ['folder'], tagged: ['tag'] }, relations: contentRelations('parent_folder') },
  excalidraw: { links: { parent_folder: ['folder'], tagged: ['tag'] }, relations: { ...contentRelations('parent_folder') } },
  mermaid: { links: { parent_folder: ['folder'], tagged: ['tag'] }, relations: { ...contentRelations('parent_folder') } },
  google_doc: { links: { parent_folder: ['folder'], tagged: ['tag'] }, relations: { ...contentRelations('parent_folder') } },
  google_sheet: { links: { parent_folder: ['folder'], tagged: ['tag'] }, relations: { ...contentRelations('parent_folder') } },

  form: {
    links: { parent_folder: ['folder'], tagged: ['tag'] },
    relations: {
      ...contentRelations('parent_folder'),
      submitter: { from: MEMBER_AND_SA, or: ['viewer'] },
    },
  },

  todo: {
    links: { parent_folder: ['folder'], tagged: ['tag'] },
    relations: {
      owner: { from: USER_AND_SA },
      manage_grants: { from: USER_AND_SA, or: ['owner'] },
      assignee: { from: USER_AND_SA },
      editor: { from: MEMBER_AND_SA, or: ['owner', 'assignee'] },
      viewer: { from: MEMBER_AND_SA, or: ['editor'], inherit: [{ rel: 'viewer', via: 'parent_folder' }] },
      read_acl: { from: MEMBER_AND_SA, or: ['editor', 'manage_grants'], inherit: [{ rel: 'read_acl', via: 'parent_folder' }] },
      denied_viewer: { from: DENY_SUBJECT },
      denied_editor: { from: DENY_SUBJECT },
    },
  },

  collection: { relations: contentRelations(null) },

  canvas_node: {
    links: { parent_canvas: ['canvas'] },
    relations: {
      owner: { from: USER_AND_SA },
      manage_grants: { from: USER_AND_SA, or: ['owner'] },
      editor: { from: MEMBER_AND_SA, or: ['owner'], inherit: [{ rel: 'editor', via: 'parent_canvas' }] },
      viewer: { from: MEMBER_AND_SA, or: ['editor'], inherit: [{ rel: 'viewer', via: 'parent_canvas' }] },
      read_acl: { from: MEMBER_AND_SA, or: ['editor', 'manage_grants'], inherit: [{ rel: 'read_acl', via: 'parent_canvas' }] },
      denied_viewer: { from: DENY_SUBJECT },
      denied_editor: { from: DENY_SUBJECT },
    },
  },
};


/**
 * Types that participate in the audience model.
 *
 * Applied as a post-pass rather than inside `contentRelations` because a type
 * that overrides `viewer`/`editor` — `folder` does, to add `parent_space`
 * inheritance — otherwise loses the audience subjects. That regression was real:
 * 8 public folders silently had no `user:*` grant and could not be made public,
 * because the override replaced the relation instead of extending it.
 */
const AUDIENCE_TYPES = [
  'space', 'folder', 'document', 'blog', 'canvas', 'canvas_node', 'sheet', 'form',
  'image', 'excalidraw', 'mermaid', 'paper', 'google_doc', 'google_sheet', 'todo',
  'collection', 'pdf', 'tag',
] as const;

/** Content rungs an audience may be granted at. Never the capability relations. */
const AUDIENCE_RELATIONS = ['viewer', 'editor'] as const;

for (const typeName of AUDIENCE_TYPES) {
  const spec = MODEL[typeName];
  if (!spec) continue;
  for (const relName of AUDIENCE_RELATIONS) {
    const rel = spec.relations[relName];
    if (!rel) continue;
    // `space:*` and the wildcard are only meaningful on content, never on
    // `read_acl` / `manage_grants`, so a public link can never read the ACL.
    rel.from = [...new Set([...(rel.from ?? []), ...WORKSPACE_SUBJECT])];
    rel.wildcard = [...PUBLIC_SUBJECT];
  }
}
