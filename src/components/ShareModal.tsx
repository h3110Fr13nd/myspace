import React, { useEffect, useState, useCallback, useRef } from 'react';
import type { LiveTuple, ResourceItem } from './iam/types';
import { GcpStylePermissionManager } from './iam/GcpStylePermissionManager';
import { Modal, Button, LoadingState } from './ui';
import { showToast } from './ui/Toast';
import { Shield, Link, Check } from 'lucide-react';
import type { Audience } from '../lib/acl/audience';

export interface ShareModalProps {
  initialResourceId?: string;
  initialTitle?: string;
  initialType?: string;
}

interface ResourceData {
  resourceId: string;
  fgaObjectId: string;
  resource: ResourceItem | null;
  directTuples: LiveTuple[];
  inheritedTuples: LiveTuple[];
  isPublic: boolean;
  isOwner: boolean;
  currentUser: string;
  /** Highest rung the viewer holds on this resource. */
  myRole?: string;
  /** Whether the viewer may change who has access. */
  canManageGrants?: boolean;
  /** False when the policy store could not be read — never render as "empty". */
  readOk?: boolean;
  /** The audience slot, so the General-access control renders real state. */
  audience?: Audience | null;
  /** Notion-style exposure classification for the resource badge. */
  exposure?: string;
  /** True when the read exceeded its page budget and the list is incomplete. */
  truncated?: boolean;
}

export const ShareModal: React.FC<ShareModalProps> = ({
  initialResourceId,
  initialTitle,
  initialType,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [resourceId, setResourceId] = useState(initialResourceId || '');
  const [resourceTitle, setResourceTitle] = useState(initialTitle || '');
  const [resourceType, setResourceType] = useState(initialType || 'document');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ResourceData | null>(null);
  const [allVaultResources, setAllVaultResources] = useState<ResourceItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [aclDenied, setAclDenied] = useState(false);
  const permissionRequest = useRef(0);

  const fetchResourcePermissions = useCallback(async (id: string, type?: string) => {
    if (!id) return;
    const request = ++permissionRequest.current;
    setLoading(true);
    setData(null);
    setAclDenied(false);
    setErrorMsg(null);
    try {
      const typeParam = type ? `&type=${encodeURIComponent(type)}` : '';
      const res = await fetch(`/api/v1/permissions/resource?id=${encodeURIComponent(id)}${typeParam}`);

      if (request !== permissionRequest.current) return;

      // Reading the ACL is gated on the `read_acl` capability, which viewers and
      // the public wildcard deliberately do not have. That is a legitimate
      // state, not an error — and it must not be shown as an empty ACL, which
      // would wrongly read as "only you can see this".
      if (res.status === 403 || res.status === 404) {
        setAclDenied(true);
        setData(null);
        setErrorMsg(null);
        setLoading(false);
        return;
      }
      if (!res.ok) {
        throw new Error(`Failed to load permissions: ${res.statusText}`);
      }
      setAclDenied(false);
      const json: ResourceData = await res.json();
      if (request !== permissionRequest.current) return;
      if (json.readOk === false) throw new Error("Access details are temporarily unavailable.");
      setData(json);
      if (json.resource?.title) setResourceTitle(json.resource.title);
      if (json.resource?.type) setResourceType(json.resource.type);
    } catch (err: any) {
      if (request !== permissionRequest.current) return;
      const message = err.message || 'Could not load access details.';
      setErrorMsg(message);
      showToast(message, { tone: 'danger' });
    } finally {
      if (request === permissionRequest.current) setLoading(false);
    }
  }, []);

  const fetchAllResources = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/resources/query?limit=50');
      if (res.ok) {
        const json = await res.json();
        setAllVaultResources(json.results || json.items || []);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  // Listen for global 'open-share-modal' events
  useEffect(() => {
    const handleOpen = (e: any) => {
      const detail = e.detail || {};
      setCopied(false);
      if (detail.resourceId) {
        setResourceId(detail.resourceId);
        setResourceTitle(detail.title || detail.resourceId);
        setResourceType(detail.type || 'document');
        setIsOpen(true);
        fetchResourcePermissions(detail.resourceId, detail.type);
        fetchAllResources();
      } else if (resourceId) {
        setIsOpen(true);
        fetchResourcePermissions(resourceId, resourceType);
        fetchAllResources();
      }
    };

    window.addEventListener('open-share-modal' as any, handleOpen);
    return () => {
      window.removeEventListener('open-share-modal' as any, handleOpen);
    };
  }, [resourceId, resourceType, fetchResourcePermissions, fetchAllResources]);

  const handleGrant = async (
    targetResource: string,
    principalToGrant: string,
    roleToGrant: string,
    action: 'grant' | 'revoke' = 'grant'
  ) => {
    if (!principalToGrant.trim()) return;
    try {
      const res = await fetch('/api/v1/permissions/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resource: targetResource,
          principal: principalToGrant.trim(),
          role: roleToGrant,
          action,
        }),
      });
      const resJson = await res.json();
      if (!res.ok || resJson.error) {
        throw new Error(resJson.error || 'Failed to update permission');
      }
      await fetchResourcePermissions(resourceId, resourceType);
    } catch (err: any) {
      throw err;
    }
  };

  /**
   * Persist an audience change through the audience API.
   *
   * Deliberately one call rather than a raw `user:*` grant: the graph tuple, the
   * audience row and the derived cache must move together, and revoking public
   * access previously required clearing all three by hand.
   */
  const handleAudienceChange = async (object: string, next: Audience): Promise<Audience> => {
    const res = await fetch('/api/v1/permissions/audience', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ object, kind: next.kind, rung: next.rung, expiresAt: next.expiresAt }),
    });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || 'Failed to change access');
    if (data) setData({ ...data, audience: json.audience, isPublic: json.audience.kind !== 'restricted' });
    return json.audience;
  };

  const handleCopyLink = async () => {
    const path = resourceType === 'folder' || resourceType === 'space'
      ? '/folders/' + encodeURIComponent(resourceId)
      : '/?doc=' + encodeURIComponent(resourceId);
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
      setCopied(true);
      showToast('Link copied', { tone: 'success' });
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
      showToast('Could not copy the link. Check your browser clipboard permission and try again.', { tone: 'danger' });
    }
  };

  const currentItem: ResourceItem = data?.resource || {
    id: resourceId,
    type: resourceType as any,
    title: resourceTitle || resourceId,
    is_public: data?.isPublic,
  };

  return (
    <Modal
      open={isOpen}
      onClose={() => setIsOpen(false)}
      size="lg"
      title={
        <div className="ui-row ui-full ui-gap-3 ui-justify-between">
          <div className="ui-row ui-gap-3 ui-align-start">
            <Shield size={20} className="ui-shrink0 ui-icon-accent" />
            <div className="ui-col ui-gap-1">
              <span>Share {resourceTitle || 'resource'}</span>
              <span className="ui-field__hint">Manage who can access this resource.</span>
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={handleCopyLink} className="ui-shrink0">
            {copied ? <Check size={14} /> : <Link size={14} />}
            {copied ? ' Copied' : ' Copy Link'}
          </Button>
        </div>
      }
    >
      {loading && !data ? (
        <LoadingState label="Loading access details…" />
      ) : errorMsg ? (
        <div role="alert" className="ui-col ui-gap-3">
          <p>{errorMsg}</p>
          <Button variant="secondary" onClick={() => fetchResourcePermissions(resourceId, resourceType)}>Retry</Button>
        </div>
      ) : aclDenied ? (
        <div className="ui-card ui-pad-6" role="status">
          <h3 className="ui-h4">Access details are private</h3>
          <p className="ui-muted">
            You can {data === null && resourceType === 'document' ? 'read' : 'use'} this resource, but you
            are not allowed to see who else has access to it. Editors and owners can.
          </p>
          <Button size="sm" variant="secondary" onClick={() => setIsOpen(false)}>
            Close
          </Button>
        </div>
      ) : (
        <GcpStylePermissionManager
          currentResource={currentItem}
          allResources={allVaultResources}
          directTuples={data?.directTuples || []}
          inheritedTuples={data?.inheritedTuples || []}
          onGrant={handleGrant}
          audience={data?.audience ?? null}
          exposure={data?.exposure}
          onAudienceChange={handleAudienceChange}
          onSelectResource={(res) => {
            setResourceId(res.id);
            setResourceTitle(res.title);
            setResourceType(res.type);
            fetchResourcePermissions(res.id, res.type);
          }}
          currentUser={data?.currentUser || 'user:anonymous'}
        />
      )}
    </Modal>
  );
};
