import React, { useState, useMemo, useEffect } from 'react';
import type { LiveTuple, ResourceItem, RoleDefinition } from './types';
import {
  DENY_RELATIONS,
  EXPOSURE_LABELS,
  ROLE_PRESENTATION,
  principalKind,
  principalLabel,
  roleOptionsFor,
  tupleKey,
} from './types';
import { getResourceIcon } from '../../lib/registry/resourceRegistry';
import { toFgaObjectId } from '../../lib/resourceId';
import { declaredRelations } from '../../lib/acl/compileModel';
import type { Audience } from '../../lib/acl/audience';
import { Badge, Button, Card, Flex, Input, IconButton, SectionHeader, Stack } from '../ui';

export interface GcpStylePermissionManagerProps {
  currentResource?: ResourceItem;
  targetResource?: ResourceItem;
  allResources?: ResourceItem[];
  directTuples?: LiveTuple[];
  inheritedTuples?: LiveTuple[];
  onGrant?: (resourceId: string, principal: string, role: string, action?: 'grant' | 'revoke') => Promise<void>;
  onSelectResource?: (resource: ResourceItem) => void;
  /** The audience slot, so the General-access control renders real state. */
  audience?: Audience | null;
  /** Notion-style exposure classification: private | workspace | shared_externally | public_link. */
  exposure?: string;
  /** Persist an audience change. Absent in read-only hosts. */
  onAudienceChange?: (object: string, next: Audience) => Promise<Audience | null>;
  onResourceChange?: (resource: ResourceItem) => void;
  currentUser?: string;
}

const memberToneClass = (user: string): string => {
  switch (principalKind(user)) {
    case 'public':
      return 'ui-badge--public';
    case 'group':
      return 'ui-badge--circle';
    case 'service_account':
      return 'ui-badge--default';
    default:
      return 'ui-badge--user';
  }
};

export const GcpStylePermissionManager: React.FC<GcpStylePermissionManagerProps> = ({
  currentResource: propCurrentResource,
  targetResource,
  allResources = [],
  directTuples = [],
  inheritedTuples = [],
  onGrant,
  onSelectResource,
  onResourceChange,
  currentUser = 'user:anonymous',
  audience: initialAudience = null,
  onAudienceChange,
}) => {
  const currentResource: ResourceItem =
    propCurrentResource ||
    targetResource ||
    allResources[0] || {
      id: 'root',
      type: 'space',
      title: 'Root Workspace',
      is_public: false,
    };

  const handleSelectResource = (res: ResourceItem) => {
    if (onSelectResource) onSelectResource(res);
    if (onResourceChange) onResourceChange(res);
  };
  // Add Principal Drawer state
  const [isGrantDrawerOpen, setIsGrantDrawerOpen] = useState(false);
  const [newPrincipalInput, setNewPrincipalInput] = useState('');
  const [selectedRole, setSelectedRole] = useState<string>('viewer');
  const [roleSearchFilter, setRoleSearchFilter] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Table Narrow Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string>('all');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<'all' | 'user' | 'circle' | 'public'>('all');
  const [selectedInheritanceFilter, setSelectedInheritanceFilter] = useState<'all' | 'direct' | 'inherited'>('all');

  // Resource Switcher state
  const [isResourcePickerOpen, setIsResourcePickerOpen] = useState(false);
  const [resourceSearchQuery, setResourceSearchQuery] = useState('');

  // Sub-tabs: 'members' vs 'troubleshooter'
  const [activeViewTab, setActiveViewTab] = useState<'members' | 'troubleshooter'>('members');
  const [troubleshootPrincipal, setTroubleshootPrincipal] = useState('user:dummy_mail');
  const [troubleshootRelation, setTroubleshootRelation] = useState('viewer');
  const [troubleshootResult, setTroubleshootResult] = useState<any>(null);

  // The single "General access" slot. Mirrors Notion: one exclusive audience with
  // its own role, composed additively with per-principal grants. Publicness is a
  // real grant in the graph, not a Postgres flag, so the troubleshooter can
  // explain it and auditing via OpenFGA is complete.
  const [audience, setAudience] = useState<Audience | null>(initialAudience);
  const [exposure, setExposure] = useState<string>('restricted');
  const [troubleshootLoading, setTroubleshootLoading] = useState(false);

  const fgaObjectId = toFgaObjectId(currentResource.type, currentResource.id);

  /**
   * Role options come from the model spec rather than a hand-maintained list, so
   * the picker cannot offer a relation the engine would reject. This previously
   * diverged: `commenter` was offered everywhere and did not exist.
   */
  const modelRelations = useMemo(
    () => declaredRelations(currentResource.type),
    [currentResource.type]
  );

  /**
   * Whether the viewer may change who has access here.
   *
   * Editing and sharing are deliberately different capabilities: `editor` can
   * read the ACL, `owner` can change it (Notion's "Can edit" vs "Full access").
   * Probed rather than threaded through as a prop so every host gets it right —
   * previously the Grant button was unconditional, so editors clicked it and
   * received a 403.
   */
  // Revocation impact. Notion gives no feedback on this, which is its most-cited
  // UX failure: you remove access and nobody tells you who lost it, or that
  // three subpages keep their own grants. Computed before committing, from the
  // projection, and shown as a confirm.
  const [pendingRevoke, setPendingRevoke] = useState<{ user: string; label: string } | null>(null);
  const [impact, setImpact] = useState<{
    affected: number;
    viaSelf: number;
    viaAncestor: number;
    subtreesUnaffected: number;
  } | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);

  const [canManageGrants, setCanManageGrants] = useState(false);
  const [canManageGrantsKnown, setCanManageGrantsKnown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCanManageGrantsKnown(false);
    (async () => {
      try {
        const res = await fetch('/api/v1/permissions/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user: currentUser,
            action: 'manage_grants',
            resource: fgaObjectId,
          }),
        });
        const json = await res.json();
        if (!cancelled) setCanManageGrants(Boolean(json.allowed));
      } catch {
        if (!cancelled) setCanManageGrants(false);
      } finally {
        if (!cancelled) setCanManageGrantsKnown(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fgaObjectId, currentUser]);

  const handleRunTroubleshoot = async () => {
    if (!troubleshootPrincipal.trim()) return;
    setTroubleshootLoading(true);
    setTroubleshootResult(null);
    try {
      const res = await fetch('/api/v1/permissions/troubleshoot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: troubleshootPrincipal.trim(),
          resource: fgaObjectId,
          relation: troubleshootRelation,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setTroubleshootResult(data);
      } else {
        setStatusMsg({ type: 'error', text: data.error || 'Evaluation failed' });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Troubleshoot network error' });
    } finally {
      setTroubleshootLoading(false);
    }
  };

  const isPublic =
    directTuples.some((t) => (t.user === 'user:*' || t.user === '*') && t.relation === 'viewer') ||
    Boolean(currentResource.is_public);

  // Combine and format tuples
  const combinedMembers = useMemo(() => {
    const list: Array<LiveTuple & { isInherited: boolean }> = [];

    directTuples.forEach((t) => {
      list.push({ ...t, isInherited: false });
    });

    inheritedTuples.forEach((t) => {
      // Don't duplicate if already directly granted
      if (!list.some((existing) => existing.user === t.user && existing.relation === t.relation)) {
        list.push({ ...t, isInherited: true });
      }
    });

    return list;
  }, [directTuples, inheritedTuples]);

  // Filtered members based on narrow filters
  const filteredMembers = useMemo(() => {
    return combinedMembers.filter((item) => {
      // 1. Text Search
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesUser = item.user.toLowerCase().includes(q);
        const matchesRole = item.relation.toLowerCase().includes(q);
        if (!matchesUser && !matchesRole) return false;
      }

      // 2. Role Filter
      if (selectedRoleFilter !== 'all' && item.relation !== selectedRoleFilter) {
        return false;
      }

      // 3. Principal Type Filter
      if (selectedTypeFilter !== 'all') {
        const kind = principalKind(item.user);
        if (selectedTypeFilter === 'public' && kind !== 'public') return false;
        if (selectedTypeFilter === 'circle' && kind !== 'group') return false;
        if (selectedTypeFilter === 'user' && (kind === 'group' || kind === 'public')) return false;
      }

      // 4. Inheritance Filter
      if (selectedInheritanceFilter === 'direct' && item.isInherited) return false;
      if (selectedInheritanceFilter === 'inherited' && !item.isInherited) return false;

      return true;
    });
  }, [combinedMembers, searchQuery, selectedRoleFilter, selectedTypeFilter, selectedInheritanceFilter]);

  const ensureGrant = async (
    resourceId: string,
    principal: string,
    role: string,
    action?: 'grant' | 'revoke'
  ): Promise<void> => {
    if (!onGrant) throw new Error('Permission updates are unavailable');
    await onGrant(resourceId, principal, role, action);
  };

  const handleApplyGrant = async () => {
    if (!newPrincipalInput.trim()) return;
    setSubmitting(true);
    setStatusMsg(null);
    try {
      let principal = newPrincipalInput.trim();
      if (!principal.includes(':') && !principal.startsWith('*')) {
        principal = `user:${principal}`;
      }

      await ensureGrant(fgaObjectId, principal, selectedRole, 'grant');
      setStatusMsg({ type: 'success', text: `Granted ${selectedRole} to ${principal}` });
      setNewPrincipalInput('');
      setIsGrantDrawerOpen(false);
      setTimeout(() => setStatusMsg(null), 3500);
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to grant permission' });
    } finally {
      setSubmitting(false);
    }
  };

  /** Stage a revocation and compute its blast radius before anything is written. */
  const handleRevokeWithImpact = async (tuple: LiveTuple) => {
    setPendingRevoke({ user: tuple.user, label: principalLabel(tuple.user) });
    setImpact(null);
    setImpactLoading(true);
    try {
      const res = await fetch('/api/v1/permissions/revocation-impact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: fgaObjectId, subject: tuple.user }),
      });
      if (res.ok) {
        const body = await res.json();
        setImpact(body.impact ?? null);
      }
    } catch {
      // A failed preview must not block the revocation; the confirm still works,
      // it just cannot promise a count.
      setImpact(null);
    } finally {
      setImpactLoading(false);
    }
  };

  const handleRevoke = async (tuple: LiveTuple) => {
    setSubmitting(true);
    setStatusMsg(null);
    try {
      await ensureGrant(fgaObjectId, tuple.user, tuple.relation, 'revoke');
      setStatusMsg({ type: 'success', text: `Revoked ${tuple.relation} from ${principalLabel(tuple.user)}` });
      setPendingRevoke(null);
      setImpact(null);
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to revoke permission' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleChangeRole = async (tuple: LiveTuple, newRole: string) => {
    if (tuple.relation === newRole) return;
    setSubmitting(true);
    setStatusMsg(null);
    try {
      // Atomic change: revoke old, grant new
      await ensureGrant(fgaObjectId, tuple.user, tuple.relation, 'revoke');
      await ensureGrant(fgaObjectId, tuple.user, newRole, 'grant');
      setStatusMsg({ type: 'success', text: `Updated ${tuple.user} to ${newRole}` });
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to update role' });
    } finally {
      setSubmitting(false);
    }
  };

  /** Change the audience slot, keeping the role when the kind is unchanged. */
  const handleAudienceChange = async (kind: Audience['kind'], rung?: 'viewer' | 'editor') => {
    const next: Audience = {
      kind,
      rung: kind === 'restricted' ? null : (rung ?? audience?.rung ?? 'viewer'),
      expiresAt: audience?.expiresAt ?? null,
    };
    setSubmitting(true);
    try {
      if (!onAudienceChange) throw new Error('Changing general access is unavailable here.');
      const saved = await onAudienceChange(fgaObjectId, next);
      setAudience(saved ?? next);
      setExposure(kind === 'public_link' ? 'public_link' : kind === 'restricted' ? 'restricted' : 'workspace');
      setStatusMsg({
        type: 'success',
        text:
          kind === 'public_link'
            ? 'Anyone with the link can now view this'
            : kind === 'workspace'
              ? 'Everyone in the workspace can now view this'
              : 'Restricted to named people',
      });
      setTimeout(() => setStatusMsg(null), 3500);
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to change access' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleTogglePublic = async () => {
    setSubmitting(true);
    try {
      const next: Audience = isPublic
        ? { kind: 'restricted', rung: null, expiresAt: null }
        : { kind: 'public_link', rung: 'viewer', expiresAt: null };

      // Routed through the audience API so the wildcard tuple, the audience row
      // and the derived is_public cache are written together. Granting
      // `user:*` by hand left the three able to disagree.
      if (onAudienceChange) {
        const saved = await onAudienceChange(fgaObjectId, next);
        setAudience(saved ?? next);
        setExposure(next.kind === 'public_link' ? 'public_link' : 'restricted');
      } else {
        await ensureGrant(fgaObjectId, 'user:*', 'viewer', isPublic ? 'revoke' : 'grant');
      }
      setStatusMsg({
        type: 'success',
        text: isPublic ? 'Resource made private' : 'Public access granted — anyone with the link can view it',
      });
      setTimeout(() => setStatusMsg(null), 3500);
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to change access' });
    } finally {
      setSubmitting(false);
    }
  };

  const filteredRoles = roleOptionsFor(modelRelations).filter(
    (r) =>
      r.title.toLowerCase().includes(roleSearchFilter.toLowerCase()) ||
      r.description.toLowerCase().includes(roleSearchFilter.toLowerCase())
  );

  return (
    <Card className="gcp-iam-manager ui-col ui-gap-5" as="section">
      {/* 1. RESOURCE HEADER & UNIVERSAL SWITCHER */}
      <Flex justify="between" align="center" wrap gap={4} className="iam-resheader">
        <Flex align="center" gap={3}>
          <div className="iam-iconbox" aria-hidden="true">
            {getResourceIcon(currentResource.type)}
          </div>
          <div>
            <Flex align="center" gap={2}>
              <h3 className="iam-res-title">{currentResource.title || currentResource.id}</h3>
              <span className="iam-res-type">{currentResource.type}</span>
            </Flex>
            <div className="iam-res-fga">
              OpenFGA Object: <code>{fgaObjectId}</code>
            </div>
          </div>
        </Flex>

        {/* Action Controls & Resource Switcher */}
        <Flex align="center" gap={2} wrap>
          {allResources.length > 1 && (onSelectResource || onResourceChange) && (
            <div className="iam-popover-anchor">
              <button
                onClick={() => setIsResourcePickerOpen(!isResourcePickerOpen)}
                className="iam-toggle"
              >
                🔄 Switch Target Resource
              </button>

              {isResourcePickerOpen && (
                <div className="iam-popover">
                  <Input
                    type="text"
                    value={resourceSearchQuery}
                    onChange={(e) => setResourceSearchQuery(e.target.value)}
                    placeholder="Search resources..."
                    autoFocus
                    aria-label="Search resources"
                  />
                  {allResources
                    .filter((r) => r.title.toLowerCase().includes(resourceSearchQuery.toLowerCase()))
                    .slice(0, 15)
                    .map((res) => (
                      <button
                        key={res.id}
                        type="button"
                        onClick={() => {
                          handleSelectResource(res);
                          setIsResourcePickerOpen(false);
                        }}
                        className={['iam-option', res.id === currentResource.id ? 'iam-option--active' : '']
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <span aria-hidden="true">{getResourceIcon(res.type)}</span>
                        <span className="iam-option__text">{res.title}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* General access — one exclusive audience with its own role.
              Modelled on Notion: a named-grants list plus a single audience slot,
              composing additively. Publicness is a real grant in the graph, so the
              troubleshooter can explain it and auditing via OpenFGA is complete. */}
          {audience && canManageGrants ? (
            <div className="iam-audience" role="group" aria-label="General access">
              <select
                value={audience.kind}
                onChange={(e) => void handleAudienceChange(e.target.value as Audience['kind'])}
                disabled={submitting}
                aria-label="Who has access"
                className="ui-select iam-select-sm"
              >
                <option value="restricted">🔒 Only people added</option>
                <option value="workspace">🏢 Everyone in the workspace</option>
                <option value="public_link">🌐 Anyone with the link</option>
              </select>
              {audience.kind !== 'restricted' && (
                <select
                  value={audience.rung ?? 'viewer'}
                  onChange={(e) =>
                    void handleAudienceChange(audience.kind, e.target.value as 'viewer' | 'editor')
                  }
                  disabled={submitting}
                  aria-label="Access level for everyone else"
                  className="ui-select iam-select-sm"
                >
                  <option value="viewer">Can view</option>
                  <option value="editor">Can edit</option>
                </select>
              )}
            </div>
          ) : (
            <span
              className="iam-toggle"
              title={
                audience
                  ? 'Only the owner can change who has access'
                  : 'Access is restricted to named people'
              }
            >
              <span>
                {audience?.kind === 'public_link'
                  ? '🌐 Anyone with the link'
                  : audience?.kind === 'workspace'
                    ? '🏢 Everyone in the workspace'
                    : '🔒 Private (Restricted)'}
              </span>
            </span>
          )}

          {/* Exposure badge — Notion's 4-value audience enum, "most permissive
              wins". Cheap, and it is what security teams actually ask for. */}
          {exposure && exposure !== 'restricted' && (
            <span
              className={[
                'ui-badge',
                exposure === 'public_link' ? 'ui-badge--public' : 'ui-badge--circle',
              ].join(' ')}
              title="Most permissive audience this resource is exposed to"
            >
              {EXPOSURE_LABELS[exposure] ?? exposure}
            </span>
          )}

          {/* Add Principal Button — only for those who may actually change access */}
          {canManageGrants ? (
            <Button variant="primary" size="sm" onClick={() => setIsGrantDrawerOpen(!isGrantDrawerOpen)}>
              + Grant Access
            </Button>
          ) : canManageGrantsKnown ? (
            <span className="iam-muted ui-copy-xs" title="Only the owner can change who has access.">
              You can see who has access, but not change it
            </span>
          ) : null}
        </Flex>
      </Flex>

      {/* 1.5 SUB-TABS: POLICY MEMBERS vs POLICY TROUBLESHOOTER */}
      <Flex gap={2} className="iam-resheader iam-rowbtns">
        <button
          onClick={() => setActiveViewTab('members')}
          className={['iam-toggle', activeViewTab === 'members' ? 'iam-toggle--on' : ''].filter(Boolean).join(' ')}
        >
          <span aria-hidden="true">🛡️</span>
          <span>Policy Members ({combinedMembers.length})</span>
        </button>
        <button
          onClick={() => setActiveViewTab('troubleshooter')}
          className={['iam-toggle', activeViewTab === 'troubleshooter' ? 'iam-toggle--warn' : ''].filter(Boolean).join(' ')}
        >
          <span aria-hidden="true">🔍</span>
          <span>Policy Troubleshooter &amp; Access Simulator</span>
        </button>
      </Flex>

      {/* REVOCATION IMPACT CONFIRM — show the blast radius before committing */}
      {pendingRevoke && canManageGrants && (
        <div className="iam-alert iam-alert--danger" role="alertdialog" aria-label="Confirm removal of access">
          <div className="ui-grow">
            <strong>Remove access for {pendingRevoke.label}?</strong>
            {impactLoading ? (
              <div className="iam-muted iam-copy-xs">Working out who this affects…</div>
            ) : impact ? (
              <ul className="iam-impact-list">
                <li>
                  Loses access here: <strong>{impact.affected}</strong>
                  {impact.affected === 0 ? ' (nothing — the grant is already gone or denied)' : ''}
                </li>
                {impact.viaAncestor > 0 && (
                  <li>{impact.viaAncestor} of those inherit it from a container</li>
                )}
                {impact.subtreesUnaffected > 0 && (
                  <li>
                    {impact.subtreesUnaffected} nested resource
                    {impact.subtreesUnaffected === 1 ? '' : 's'} keep their own grant and are unaffected
                  </li>
                )}
              </ul>
            ) : (
              <div className="iam-muted iam-copy-xs">
                Could not compute the impact. You can still remove the access.
              </div>
            )}
          </div>
          <Flex gap={2} className="ui-shrink0">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setPendingRevoke(null);
                setImpact(null);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={submitting}
              loading={submitting}
              onClick={() => {
                const target = combinedMembers.find(
                  (m) => m.user === pendingRevoke.user && !m.isInherited
                );
                if (target) void handleRevoke(target);
                else {
                  setPendingRevoke(null);
                  setImpact(null);
                }
              }}
            >
              Remove access
            </Button>
          </Flex>
        </div>
      )}

      {/* STATUS NOTIFICATION TOAST */}
      {statusMsg && (
        <div className={['iam-alert', statusMsg.type === 'success' ? 'iam-alert--success' : 'iam-alert--danger'].join(' ')}>
          {statusMsg.text}
        </div>
      )}

      {activeViewTab === 'members' && (
        <>
          {/* 2. GCP-STYLE "GRANT ACCESS / ADD PRINCIPAL" EXPANDABLE DRAWER */}
          {isGrantDrawerOpen && (
            <div className="iam-grant ui-col ui-gap-3">
              <Flex justify="between" align="center">
                <div className="iam-grant-title">👤 Add Principals &amp; Assign Roles</div>
                <IconButton label="Close grant panel" ghost onClick={() => setIsGrantDrawerOpen(false)}>
                  ✕
                </IconButton>
              </Flex>

              {/* Principal Input with Suggestion Pills */}
              <Stack gap={1}>
                <label className="ui-field__label">New Principals (Email, Username, or Circle ID)</label>
                <Input
                  type="text"
                  value={newPrincipalInput}
                  onChange={(e) => setNewPrincipalInput(e.target.value)}
                  placeholder="e.g. <dummy_mail>, user:bob, group:engineers#member"
                />
                {/* Suggestion Pills */}
                <Flex gap={1} wrap className="iam-pills">
                  {['group:engineers#member', 'group:contractors#member', 'user:*'].map((sug) => (
                    <button key={sug} type="button" onClick={() => setNewPrincipalInput(sug)} className="iam-pill">
                      +{sug}
                    </button>
                  ))}
                </Flex>
              </Stack>

              {/* Role Selection with Narrow Role Filter */}
              <Stack gap={1}>
                <Flex justify="between" align="center">
                  <label className="ui-field__label">Assign Role</label>
                  <Input
                    type="text"
                    value={roleSearchFilter}
                    onChange={(e) => setRoleSearchFilter(e.target.value)}
                    placeholder="Filter roles..."
                    className="iam-rolefilter"
                  />
                </Flex>

                <div className="iam-rolegrid">
                  {filteredRoles.map((role) => {
                    const isSelected = selectedRole === role.id;
                    return (
                      <div
                        key={role.id}
                        onClick={() => setSelectedRole(role.id)}
                        className={['iam-rolecard', isSelected ? 'iam-rolecard--active' : ''].filter(Boolean).join(' ')}
                      >
                        <div className="ui-row ui-gap-2 iam-rolecard__head">
                          <span className="iam-roleicon" aria-hidden="true">{role.icon}</span>
                          <span className="iam-rolecard__title">{role.title}</span>
                        </div>
                        <div className="iam-rolecard__desc">{role.description}</div>
                      </div>
                    );
                  })}
                </div>
              </Stack>

              {/* Drawer Footer Buttons */}
              <Flex justify="end" gap={2} className="iam-pills">
                <Button variant="ghost" size="sm" onClick={() => setIsGrantDrawerOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleApplyGrant}
                  disabled={submitting || !newPrincipalInput.trim()}
                  loading={submitting}
                >
                  {submitting ? 'Saving...' : 'Save Permission'}
                </Button>
              </Flex>
            </div>
          )}

          {/* 3. NARROW FILTER BAR (GCP STYLE) */}
          <div className="iam-filterbar">
            {/* Search Principals */}
            <div className="iam-filtergrow ui-row ui-gap-2">
              <span className="iam-filtericon" aria-hidden="true">🔍</span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter principals by name, email, or role..."
                aria-label="Filter principals"
                className="ui-input iam-input-transparent"
              />
            </div>

            {/* Narrow Filters */}
            <Flex align="center" gap={2} wrap>
              {/* Role Filter Selector */}
              <select
                value={selectedRoleFilter}
                onChange={(e) => setSelectedRoleFilter(e.target.value)}
                aria-label="Filter by role"
                className="ui-select iam-select-sm"
              >
                <option value="all">All Roles ({combinedMembers.length})</option>
                {roleOptionsFor(modelRelations).map((role) => (
                  <option key={role.id} value={role.id}>{role.title}</option>
                ))}
              </select>

              {/* Member Type Filter Selector */}
              <select
                value={selectedTypeFilter}
                onChange={(e) => setSelectedTypeFilter(e.target.value as any)}
                aria-label="Filter by member type"
                className="ui-select iam-select-sm"
              >
                <option value="all">All Member Types</option>
                <option value="user">Users</option>
                <option value="circle">Circles / Groups</option>
                <option value="public">Public Wildcard</option>
              </select>

              {/* Inheritance Filter */}
              <select
                value={selectedInheritanceFilter}
                onChange={(e) => setSelectedInheritanceFilter(e.target.value as any)}
                aria-label="Filter by inheritance scope"
                className="ui-select iam-select-sm"
              >
                <option value="all">All Grants</option>
                <option value="direct">Direct Grants Only</option>
                <option value="inherited">Inherited Only</option>
              </select>
            </Flex>
          </div>

          {/* 4. GCP-STYLE MEMBERS MATRIX TABLE */}
          <div className="iam-tablewrap">
            <table className="iam-table">
              <thead>
                <tr>
                  <th>Principal / Member</th>
                  <th>Type</th>
                  <th>Assigned Role (In-Place Edit)</th>
                  <th>Inheritance Scope</th>
                  <th className="iam-th-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="iam-empty iam-td-empty">
                      {combinedMembers.length > 0
                        ? 'No members match the current filter criteria.'
                        : 'No one has been given access to this resource directly, and no container grants access to it.'}
                    </td>
                  </tr>
                ) : (
                  filteredMembers.map((tuple, idx) => {
                    const kind = principalKind(tuple.user);
                    const isWildcard = kind === 'public';
                    const isCircle = kind === 'group';
                    const isDeny = (DENY_RELATIONS as readonly string[]).includes(tuple.relation);
                    const memberType = isDeny ? 'Restriction' : isWildcard ? 'Public' : isCircle ? 'Group' : 'User';
                    const cleanName = principalLabel(tuple.user);

                    return (
                      <tr key={tupleKey(tuple, idx)}>
                        {/* Principal Name & Avatar */}
                        <td>
                          <div className="ui-row ui-gap-3">
                            <div
                              aria-hidden="true"
                              className={[
                                'iam-avatar',
                                isWildcard ? 'iam-avatar--public' : isCircle ? 'iam-avatar--circle iam-avatar--square' : 'iam-avatar--user',
                              ]
                                .join(' ')}
                            >
                              {isWildcard ? '🌐' : isCircle ? '👥' : cleanName[0].toUpperCase()}
                            </div>
                            <div>
                              <div className="iam-membername">
                                {isWildcard ? 'Anyone on the internet (Public)' : cleanName}
                              </div>
                              <div className="iam-mono iam-memberid">
                                {tuple.user}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Member Type Badge */}
                        <td>
                          <Badge tone="default" className={memberToneClass(tuple.user)}>
                            {memberType}
                          </Badge>
                        </td>

                        {/* In-Place Role Change Dropdown */}
                        <td>
                          {tuple.isInherited ? (
                            <span className="iam-ro-relationship">
                              {tuple.relation} (Read-Only)
                            </span>
                          ) : (
                            <select
                              value={tuple.relation}
                              onChange={(e) => handleChangeRole(tuple, e.target.value)}
                              disabled={submitting}
                              aria-label={`Change role for ${tuple.user}`}
                              className="ui-select iam-select-role"
                            >
                              {roleOptionsFor(modelRelations).map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.title}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>

                        {/* Provenance — where the grant actually came from.
                            Notion renders inherited and direct grants as identical
                            rows and discloses provenance only for *you*, which is why
                            "who can see this?" is unanswerable in most products. */}
                        <td>
                          {tuple.isInherited ? (
                            <span className="iam-inherit" title={tuple.sourceTitle || tuple.object}>
                              <span aria-hidden="true">↳ </span>Inherited
                              {tuple.sourceTitle ? (
                                <span className="iam-inherit__from"> from {tuple.sourceTitle}</span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="iam-direct">
                              <span aria-hidden="true">✓ </span>Direct
                            </span>
                          )}
                        </td>

                        {/* Revoke — shows who is actually affected first */}
                        <td className="iam-th-right">
                          <button
                            onClick={() => handleRevokeWithImpact(tuple)}
                            disabled={submitting || !canManageGrants}
                            title={
                              canManageGrants
                                ? 'See who loses access, then remove it'
                                : 'Only the owner can change who has access'
                            }
                            className="iam-revoke"
                          >
                            Revoke
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* 5. GCP POLICY TROUBLESHOOTER & ACCESS SIMULATOR VIEW */}
      {activeViewTab === 'troubleshooter' && (
        <div className="iam-trouble">
          <div>
            <h4 className="iam-result__title iam-subhead">
              🔍 GCP Policy Troubleshooter &amp; Resolution Analyzer
            </h4>
            <p className="iam-muted iam-copy">
              Evaluate why a principal does or does not have access to this resource, inspecting direct tuples, group memberships, and container inheritance.
            </p>
          </div>

          <div className="iam-fieldgrid">
            <Stack gap={1}>
              <label className="ui-field__label">Principal (User or Circle)</label>
              <Input
                type="text"
                value={troubleshootPrincipal}
                onChange={(e) => setTroubleshootPrincipal(e.target.value)}
                placeholder="e.g. user:<dummy_mail> or group:engineers#member"
              />
              {/* Quick Autocomplete Suggestions */}
              <Flex gap={1} wrap className="iam-pills">
                {['user:dummy_mail', 'user:dummy_mail', 'group:engineers#member', 'user:*'].map((p) => (
                  <button key={p} type="button" onClick={() => setTroubleshootPrincipal(p)} className="iam-pill iam-pill--violet">
                    {p}
                  </button>
                ))}
              </Flex>
            </Stack>

            <Stack gap={1}>
              <label className="ui-field__label">Action / Permission Level to Test</label>
              <select
                value={troubleshootRelation}
                onChange={(e) => setTroubleshootRelation(e.target.value)}
                aria-label="Permission level to test"
                className="ui-select"
              >
                {roleOptionsFor(modelRelations, { includeDenies: false }).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title} — {r.description}
                  </option>
                ))}
              </select>
            </Stack>
          </div>

          <div>
            <Button variant="primary" onClick={handleRunTroubleshoot} disabled={troubleshootLoading} loading={troubleshootLoading}>
              {troubleshootLoading ? '⏳ Evaluating Policy...' : '⚡ Evaluate Access'}
            </Button>
          </div>

          {/* Troubleshoot Evaluation Result */}
          {troubleshootResult && (
            <div className={['iam-result', troubleshootResult.isAllowed ? 'iam-result--allowed' : 'iam-result--denied'].join(' ')}>
              <Flex align="center" gap={2} className="iam-mb4">
                <span className="iam-result__icon" aria-hidden="true">{troubleshootResult.isAllowed ? '✅' : '❌'}</span>
                <div>
                  <h4 className="iam-result__title">
                    Access {troubleshootResult.isAllowed ? 'GRANTED' : 'DENIED'}
                  </h4>
                  <div className="iam-result__meta">
                    Effective Role: <strong className="iam-strong">{(troubleshootResult.effectiveRole || 'none').toUpperCase()}</strong> on{' '}
                    <code>{troubleshootResult.resource}</code>
                  </div>
                </div>
              </Flex>

              <h5 className="iam-subhead iam-subhead--flush">
                ReBAC Resolution Path &amp; Rule Breakdown:
              </h5>

              <Stack gap={2}>
                {(troubleshootResult.resolutionSteps || []).map((step: any, idx: number) => (
                  <div key={idx} className={['iam-step', step.matched ? 'iam-step--matched' : ''].filter(Boolean).join(' ')}>
                    <span className={['iam-step__mark', step.matched ? '' : 'iam-step__mark--miss'].join(' ')} aria-hidden="true">
                      {step.matched ? '✓' : '✕'}
                    </span>
                    <div className="ui-grow">
                      <Flex align="center" gap={2}>
                        <span className={['iam-step__type', step.matched ? '' : 'iam-step__type--miss'].join(' ')}>
                          {step.type}
                        </span>
                        <span className="iam-step__rule">{step.rule}</span>
                      </Flex>
                      <div className="iam-step__detail">{step.detail}</div>
                    </div>
                  </div>
                ))}
              </Stack>
            </div>
          )}
        </div>
      )}
    </Card>
  );
};
