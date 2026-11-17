/**
 * Shared IAM types.
 *
 * ── Role list ───────────────────────────────────────────────────────────────
 *
 * `SYSTEM_ROLES` no longer contains a `commenter` rung. It did, and the model
 * never defined one, so every attempt to grant it was rejected by the engine
 * while the UI kept offering it — the dropdown and the authorization model
 * disagreed about what exists.
 *
 * Roles offered in the UI are now derived from the deployed model via
 * `roleOptionsFor()`, so the two cannot drift. `commenter` is a legitimate rung
 * in the wider ecosystem (Notion "Can comment", Google Drive `commenter`), and
 * adding it later is a model deploy plus a capability-table entry — no UI change.
 */

/** Relations that grant access to content, weakest → strongest. */
export const CONTENT_ROLES = ['viewer', 'editor', 'owner'] as const;
export type ContentRole = (typeof CONTENT_ROLES)[number];

/** Explicit restriction relations, checked by `guards.can()`. */
export const DENY_RELATIONS = ['denied_viewer', 'denied_editor'] as const;

/** Capability relations, distinct from the content ladder. */
export const CAPABILITY_RELATIONS = ['read_acl', 'manage_grants'] as const;

export interface LiveTuple {
  user: string;
  relation: string;
  object: string;
  /** Display name of the container an inherited grant came from. */
  sourceTitle?: string;
  isInherited?: boolean;
}

export interface ResourceItem {
  id: string;
  type: string;
  title: string;
  owner_id?: string;
  parent_id?: string;
  is_public?: boolean;
  path?: string;
  metadata?: Record<string, any>;
}

export type PermissionRelation = ContentRole | (typeof DENY_RELATIONS)[number] | (typeof CAPABILITY_RELATIONS)[number] | string;

export interface GrantPayload {
  resource: string;
  principal: string;
  role: string;
  action?: 'grant' | 'revoke';
}

export interface RoleDefinition {
  id: string;
  title: string;
  description: string;
  icon: string;
  permissions: string[];
  color: string;
}

/** Human labels and affordances. The set of *valid* roles comes from the model. */
export const ROLE_PRESENTATION: Record<string, Omit<RoleDefinition, 'permissions'>> = {
  owner: {
    id: 'owner',
    title: 'Owner',
    description: 'Full control, including changing who has access to this resource.',
    icon: '👑',
    color: 'var(--accent-amber)',
  },
  editor: {
    id: 'editor',
    title: 'Editor',
    description: 'Can edit content and see who has access, but cannot change access.',
    icon: '✍️',
    color: 'var(--accent-cyan)',
  },
  commenter: {
    id: 'commenter',
    title: 'Commenter',
    description: 'Can read and comment, but not edit or change access.',
    icon: '💬',
    color: 'var(--accent-emerald)',
  },
  viewer: {
    id: 'viewer',
    title: 'Viewer',
    description: 'Read-only. Cannot see who else has access.',
    icon: '👁️',
    color: 'var(--accent-primary)',
  },
  denied_viewer: {
    id: 'denied_viewer',
    title: 'Blocked',
    description: 'Explicitly denied access here, overriding anything inherited.',
    icon: '⛔',
    color: 'var(--accent-rose, #f43f5e)',
  },
  denied_editor: {
    id: 'denied_editor',
    title: 'View only',
    description: 'Access inherited, but editing is blocked here.',
    icon: '🔒',
    color: 'var(--accent-amber)',
  },
};

/** Roles a user may hold, in ladder order. */
export const SYSTEM_ROLES: RoleDefinition[] = CONTENT_ROLES.map((id) => {
  const p = ROLE_PRESENTATION[id];
  return {
    ...p,
    permissions:
      id === 'owner'
        ? ['content.read', 'content.write', 'rebac.policy.manage', 'acl.read']
        : id === 'editor'
          ? ['content.read', 'content.write', 'acl.read']
          : ['content.read'],
  };
});

/**
 * Relative strength of every grantable rung, strongest → weakest.
 *
 * Includes `commenter` even though the model does not define it yet, so that
 * adding the relation later makes it offerable with no UI change. Intersecting
 * this list with the model's relations — rather than iterating the roles that
 * happen to exist today — is what keeps the picker honest: it can only ever
 * offer something the engine will accept.
 */
const STRENGTH_ORDER = ['owner', 'editor', 'commenter', 'viewer'] as const;

/**
 * Roles to offer for a type: the intersection of what the model defines and what
 * we know how to present, ordered strongest → weakest.
 *
 * An unknown type yields the full default ladder rather than an empty picker.
 */
export function roleOptionsFor(
  modelRelations: string[] | undefined,
  opts: { includeDenies?: boolean } = {}
): RoleDefinition[] {
  if (!modelRelations?.length) return SYSTEM_ROLES;

  const base = STRENGTH_ORDER.filter((id) => modelRelations.includes(id))
    .map((id) => {
      const presentation = ROLE_PRESENTATION[id];
      if (!presentation) return null;
      return {
        ...presentation,
        permissions:
          id === 'owner'
            ? ['content.read', 'content.write', 'rebac.policy.manage', 'acl.read']
            : id === 'editor'
              ? ['content.read', 'content.write', 'acl.read']
              : ['content.read'],
      } as RoleDefinition;
    })
    .filter((r): r is RoleDefinition => Boolean(r));

  return opts.includeDenies
    ? [...base, ...DENY_RELATIONS.map((d) => ({ ...ROLE_PRESENTATION[d], permissions: [] }))]
    : base;
}

/** Shape of a principal token as it appears in a tuple. */
export type PrincipalKind = 'user' | 'group' | 'service_account' | 'public';

/**
 * Classify a principal.
 *
 * Groups are `group` with a `group#member` userset — there has never been a
 * `circle` type in the model, so the UI's `circle:` handling could never match a
 * real tuple.
 */
export function principalKind(user: string): PrincipalKind {
  if (user === 'user:*' || user === '*') return 'public';
  if (user.startsWith('group:') || user.endsWith('#member')) return 'group';
  if (user.startsWith('service_account:')) return 'service_account';
  return 'user';
}

/** Display label for a principal, unwrapping the userset suffix. */
export function principalLabel(user: string): string {
  if (user === 'user:*' || user === '*') return 'Anyone with the link';
  return user.replace(/^user:|^group:|^service_account:/, '').replace(/#member$/, '');
}

/** Stable React key for a tuple row. */
export function tupleKey(t: LiveTuple, idx: number): string {
  return `${t.object}|${t.user}|${t.relation}|${idx}`;
}

/**
 * Notion's 4-value audience classification, "most permissive wins".
 *
 * Cheap, high signal, and it is the artifact security teams actually ask for
 * ("what is our exposure?"). `restricted` is deliberately not labelled: it is the
 * absence of a finding, not a state worth a badge.
 */
export const EXPOSURE_LABELS: Record<string, string> = {
  workspace: 'Shared internally',
  shared_externally: 'Shared externally',
  public_link: 'Shared to web',
};
