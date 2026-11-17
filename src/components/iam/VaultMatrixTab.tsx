import React, { useState } from 'react';
import type { LiveTuple, ResourceItem } from './types';
import { PermissionBadge } from './PermissionBadge';
import { RoleSelector } from './RoleSelector';
import { toFgaObjectId } from '../../lib/resourceId';
import { declaredRelations } from '../../lib/acl/compileModel';
import { getResourceIcon } from '../../lib/registry/resourceRegistry';
import { Button, Flex, Input, Stack } from '../ui';

interface VaultMatrixTabProps {
  resources: ResourceItem[];
  tuples: LiveTuple[];
  onGrant: (resource: string, principal: string, role: string, action?: 'grant' | 'revoke') => Promise<void>;
  onOpenShareModal: (resourceId: string, title: string, type: string) => void;
}

export const VaultMatrixTab: React.FC<VaultMatrixTabProps> = ({
  resources,
  tuples,
  onGrant,
  onOpenShareModal,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>(resources[0]?.id || '');
  const [principalInput, setPrincipalInput] = useState('');
  const [roleInput, setRoleInput] = useState('viewer');
  const [submitting, setSubmitting] = useState(false);

  const filteredResources = resources.filter(
    (r) =>
      r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedRes = resources.find((r) => r.id === selectedId) || resources[0];
  const fgaObjectId = selectedRes ? toFgaObjectId(selectedRes.type, selectedRes.id) : '';

  // Direct tuples for this object
  const directTuples = selectedRes
    ? tuples.filter((t) => t.object === fgaObjectId || t.object === selectedRes.id)
    : [];

  const isPublic =
    directTuples.some((t) => (t.user === 'user:*' || t.user === '*') && t.relation === 'viewer') ||
    !!selectedRes?.is_public;

  // Parent inheritance
  const parentRes = selectedRes?.parent_id ? resources.find((r) => r.id === selectedRes.parent_id) : null;
  const parentFgaId = parentRes ? toFgaObjectId(parentRes.type, parentRes.id) : selectedRes?.parent_id;
  const parentTuples = parentFgaId
    ? tuples.filter((t) => t.object === parentFgaId || t.object === selectedRes?.parent_id)
    : [];

  const handleApply = async () => {
    if (!principalInput.trim() || !fgaObjectId) return;
    setSubmitting(true);
    try {
      await onGrant(fgaObjectId, principalInput.trim(), roleInput, 'grant');
      setPrincipalInput('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTogglePublic = async () => {
    if (!fgaObjectId) return;
    await onGrant(fgaObjectId, 'user:*', 'viewer', isPublic ? 'revoke' : 'grant');
  };

  return (
    <Flex align="start" gap={5} className="iam-split">
      {/* Left Tree / Resource Pane */}
      <div className="iam-sidebar iam-sidebar--wide">
        <Input
          type="text"
          placeholder="Search notes & folders..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search resources"
        />

        <div className="iam-list">
          {filteredResources.map((r) => {
            const isSelected = r.id === selectedRes?.id;
            return (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={['iam-list-item', isSelected ? 'iam-list-item--active' : ''].filter(Boolean).join(' ')}
              >
                <span aria-hidden="true">{getResourceIcon(r.type)}</span>
                <span className="iam-list-item__text">{r.title || r.id}</span>
              </button>
            );
          })}
          {filteredResources.length === 0 && (
            <div className="iam-empty">No matching resources found.</div>
          )}
        </div>
      </div>

      {/* Right Detail Pane */}
      <Stack gap={4} className="iam-pane">
        {selectedRes ? (
          <>
            {/* Header Card */}
            <Flex justify="between" align="center" wrap gap={4} className="iam-panel iam-panel--pad">
              <div>
                <Flex align="center" gap={2}>
                  <span className="iam-resicon" aria-hidden="true">{getResourceIcon(selectedRes.type)}</span>
                  <h2 className="iam-res-title">{selectedRes.title || selectedRes.id}</h2>
                </Flex>
                <div className="iam-res-fga">{fgaObjectId}</div>
              </div>

              <Flex gap={2} align="center">
                <button
                  onClick={handleTogglePublic}
                  className={['iam-toggle', isPublic ? 'iam-toggle--warn' : 'iam-toggle--on'].join(' ')}
                >
                  {isPublic ? '\ud83d\udd12 Make Restricted' : '\ud83c\udf10 Make Public'}
                </button>
                <button
                  onClick={() => onOpenShareModal(selectedRes.id, selectedRes.title, selectedRes.type)}
                  className="iam-toggle"
                >
                  {'\ud83d\udd17'} Share Modal
                </button>
              </Flex>
            </Flex>

            {/* Add Rule Form */}
            <div className="iam-panel iam-panel--sm iam-panel--pad">
              <h4 className="iam-widget-title">Add Collaborator or Explicit Deny Policy</h4>
              <Flex gap={2} wrap>
                <Input
                  type="text"
                  placeholder="user:<dummy_mail> or group:researchers"
                  value={principalInput}
                  onChange={(e) => setPrincipalInput(e.target.value)}
                  aria-label="Principal"
                  className="ui-grow iam-principal-input"
                />
                <RoleSelector
                  value={roleInput}
                  modelRelations={selectedRes ? declaredRelations(selectedRes.type) : []}
                  onChange={setRoleInput}
                />
                <Button
                  variant="primary"
                  disabled={submitting || !principalInput.trim()}
                  loading={submitting}
                  onClick={handleApply}
                >
                  {submitting ? 'Applying...' : 'Apply Rule'}
                </Button>
              </Flex>
            </div>

            {/* Active Rules List */}
            <div>
              <h4 className="iam-widget-title iam-rowline">
                <span>Direct Access & Block Rules</span>
                <span className="iam-rulecount">{directTuples.length} active rules</span>
              </h4>
              <Stack gap={2}>
                {directTuples.length === 0 ? (
                  <div className="iam-empty">No direct rules assigned. Inherits default vault policies.</div>
                ) : (
                  directTuples.map((t, idx) => {
                    const isDeny = t.relation.startsWith('denied_');
                    const isGroup = t.user.startsWith('group:');
                    return (
                      <div
                        key={`${t.user}-${t.relation}-${idx}`}
                        className={['iam-list-row', isDeny ? 'iam-list-row--deny' : ''].filter(Boolean).join(' ')}
                      >
                        <div className="ui-row ui-gap-3">
                          <span className="iam-roleicon" aria-hidden="true">{isDeny ? '\ud83d\udeab' : isGroup ? '\ud83d\udc65' : '\ud83d\udc64'}</span>
                          <div>
                            <div className="iam-membername">{t.user}</div>
                            <div className="iam-memberid">{isGroup ? 'Group / Circle' : 'User'}</div>
                          </div>
                        </div>

                        <div className="ui-row ui-gap-2">
                          <PermissionBadge relation={t.relation} />
                          <button
                            onClick={() => onGrant(fgaObjectId, t.user, t.relation, 'revoke')}
                            className="iam-revoke"
                            title="Revoke Permission"
                          >
                            &times;
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </Stack>
            </div>

            {/* Inherited Rules */}
            {parentTuples.length > 0 && (
              <div className="iam-mt2">
                <h4 className="iam-widget-title">📁 Inherited via Parent Folder ({parentRes?.title || selectedRes.parent_id})</h4>
                <Stack gap={2}>
                  {parentTuples.map((pt, idx) => (
                    <div key={`parent-inh-${idx}`} className="iam-list-row iam-list-row--dashed">
                      <span>{'\ud83d\udd17'} {pt.user}</span>
                      <PermissionBadge relation={pt.relation} isInherited />
                    </div>
                  ))}
                </Stack>
              </div>
            )}
          </>
        ) : (
          <div className="iam-empty">No resources available.</div>
        )}
      </Stack>
    </Flex>
  );
};
