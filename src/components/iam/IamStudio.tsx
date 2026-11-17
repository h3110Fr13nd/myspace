import React, { useState } from 'react';
import type { LiveTuple, ResourceItem } from './types';
import { VaultMatrixTab } from './VaultMatrixTab';
import { CirclesTab } from './CirclesTab';
import { PeopleTab } from './PeopleTab';
import { TupleInspectorTab } from './TupleInspectorTab';
import { GcpStylePermissionManager } from './GcpStylePermissionManager';
import { toFgaObjectId } from '../../lib/resourceId';
import { Card, Flex, Stack, Button } from '../ui';

export interface IamStudioProps {
  /**
   * Optional seed tuples. The page no longer embeds the relationship graph in
   * the HTML; the studio fetches it from `/api/v1/permissions/all-tuples`,
   * which is gated on workspace-level `manage_grants`.
   */
  initialTuples?: LiveTuple[];
  allResources: ResourceItem[];
  currentUser?: string;
  fgaError?: string | null;
}

export const IamStudio: React.FC<IamStudioProps> = ({
  initialTuples,
  allResources,
  currentUser = 'user:anonymous',
  fgaError,
}) => {
  const [activeTab, setActiveTab] = useState<'gcp' | 'vault' | 'circles' | 'people' | 'raw'>('gcp');
  const [tuples, setTuples] = useState<LiveTuple[]>(initialTuples || []);
  const [tuplesLoading, setTuplesLoading] = useState(!initialTuples?.length);
  const [tuplesTruncated, setTuplesTruncated] = useState(false);

  // The relationship graph is fetched only after the page-level gate has passed,
  // so it is never serialised into the document.
  React.useEffect(() => {
    if (initialTuples?.length) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v1/permissions/all-tuples');
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setErrorMsg(body.error || 'Could not load the authorization graph.');
          return;
        }
        const json = await res.json();
        if (cancelled) return;
        setTuples(json.tuples || []);
        setTuplesTruncated(Boolean(json.truncated));
      } catch (e: any) {
        if (!cancelled) setErrorMsg(e.message || 'Could not load the authorization graph.');
      } finally {
        if (!cancelled) setTuplesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialTuples]);
  const [resources, setResources] = useState<ResourceItem[]>(allResources || []);
  const [selectedResource, setSelectedResource] = useState<ResourceItem | null>(allResources?.[0] || null);
  const [errorMsg, setErrorMsg] = useState<string | null>(fgaError || null);
  const [refreshing, setRefreshing] = useState(false);

  const handleGrant = async (
    resource: string,
    principal: string,
    role: string,
    action: 'grant' | 'revoke' = 'grant'
  ) => {
    setErrorMsg(null);
    try {
      const res = await fetch('/api/v1/permissions/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource, principal, role, action }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || 'Failed to update permission');
      }

      const normalizedPrincipal = principal.includes(':') ? principal : `user:${principal}`;

      // Update local state
      if (action === 'revoke') {
        setTuples((prev) =>
          prev.filter(
            (t) =>
              !(t.object === resource && t.user === normalizedPrincipal && t.relation === role)
          )
        );
        if (normalizedPrincipal === 'user:*' || normalizedPrincipal === '*') {
          const rawId = resource.includes(':') ? resource.split(':')[1] : resource;
          setResources((prev) =>
            prev.map((r) => (r.id === rawId ? { ...r, is_public: false } : r))
          );
        }
      } else {
        setTuples((prev) => [
          ...prev,
          { object: resource, user: normalizedPrincipal, relation: role },
        ]);
        if (normalizedPrincipal === 'user:*' || normalizedPrincipal === '*') {
          const rawId = resource.includes(':') ? resource.split(':')[1] : resource;
          setResources((prev) =>
            prev.map((r) => (r.id === rawId ? { ...r, is_public: true } : r))
          );
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error communicating with permissions API');
    }
  };

  const handleOpenShareModal = (resourceId: string, title: string, type: string) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('open-share-modal', {
          detail: { resourceId, title, type },
        })
      );
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setErrorMsg(null);
    try {
      window.location.reload();
    } finally {
      setRefreshing(false);
    }
  };

  const tabs: Array<{ id: 'gcp' | 'vault' | 'circles' | 'people' | 'raw'; label: string; icon: string }> = [
    { id: 'gcp', label: 'Cloud IAM Policy Studio', icon: '🛡️' },
    { id: 'vault', label: 'Vault Access Matrix', icon: '📁' },
    { id: 'circles', label: 'Circles & Groups', icon: '👥' },
    { id: 'people', label: 'People & Collaborators', icon: '👤' },
    { id: 'raw', label: 'ReBAC Tuple Inspector', icon: '⚡' },
  ];

  return (
    <Stack gap={5}>
      {/* Header Banner */}
      <Flex justify="between" align="center" wrap gap={4}>
        <div>
          <h1 className="iam-title">
            🛡️ Access Control & IAM Studio
          </h1>
          <p className="iam-subtitle">
            Fine-grained OpenFGA ReBAC engine • Explicit Allow/Deny Policies • Circles & Collaborators
          </p>
        </div>

        <Button variant="secondary" size="sm" onClick={handleRefresh}>
          {refreshing ? 'Refreshing...' : '🔄 Refresh Tuples'}
        </Button>
      </Flex>

      {errorMsg && (
        <div className="iam-alert iam-alert--danger">⚠️ {errorMsg}</div>
      )}

      {/* Main Studio Layout */}
      <Flex align="start" gap={5} className="iam-studio-split">
        {/* Sidebar Nav */}
        <Stack gap={2} className="iam-sidebar iam-sidebar--nav">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                className={['iam-nav-item', isActive ? 'iam-nav-item--active' : ''].filter(Boolean).join(' ')}
                onClick={() => setActiveTab(tab.id)}
              >
                <span aria-hidden="true">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </Stack>

        {/* Panel Content */}
        <Card className="iam-studio-panel">
          {activeTab === 'gcp' && (
            <GcpStylePermissionManager
              currentResource={selectedResource || resources[0]}
              targetResource={selectedResource || resources[0]}
              allResources={resources}
              directTuples={tuples.filter((t) => {
                const target = selectedResource || resources[0];
                return target ? t.object === toFgaObjectId(target.type, target.id) : false;
              })}
              inheritedTuples={[]}
              onGrant={handleGrant}
              onSelectResource={(res) => setSelectedResource(res)}
              onResourceChange={(res) => setSelectedResource(res)}
              currentUser={currentUser}
            />
          )}

          {activeTab === 'vault' && (
            <VaultMatrixTab
              resources={resources}
              tuples={tuples}
              onGrant={handleGrant}
              onOpenShareModal={handleOpenShareModal}
            />
          )}

          {activeTab === 'circles' && (
            <CirclesTab resources={resources} tuples={tuples} onGrant={handleGrant} />
          )}

          {activeTab === 'people' && (
            <PeopleTab resources={resources} tuples={tuples} />
          )}

          {activeTab === 'raw' && (
            <TupleInspectorTab tuples={tuples} onGrant={handleGrant} />
          )}
        </Card>
      </Flex>
    </Stack>
  );
};