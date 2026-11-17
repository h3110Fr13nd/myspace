import React, { useState } from 'react';
import type { LiveTuple, ResourceItem } from './types';
import { PermissionBadge } from './PermissionBadge';
import { Button, Flex, Input } from '../ui';

interface CirclesTabProps {
  resources: ResourceItem[];
  tuples: LiveTuple[];
  onGrant: (resource: string, principal: string, role: string, action?: 'grant' | 'revoke') => Promise<void>;
}

export const CirclesTab: React.FC<CirclesTabProps> = ({ resources, tuples, onGrant }) => {
  const [newCircleName, setNewCircleName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Extract all groups
  const groups = Array.from(
    new Set(
      tuples
        .filter((t) => t.object.startsWith('group:') || t.user.startsWith('group:'))
        .map((t) => (t.object.startsWith('group:') ? t.object : t.user.replace('#member', '')))
    )
  ).sort();

  const [selectedGroup, setSelectedGroup] = useState<string>(groups[0] || '');
  const activeGroup = selectedGroup || groups[0] || '';

  // Members of active group
  const memberTuples = tuples.filter(
    (t) => t.object === activeGroup && t.relation === 'member'
  );

  // Resources shared with active group
  const groupTarget = `${activeGroup}#member`;
  const resTuples = tuples.filter(
    (t) => (t.user === groupTarget || t.user === activeGroup) && !t.object.startsWith('group:')
  );

  const handleCreateCircle = async () => {
    const clean = newCircleName.trim().replace(/^group:/, '');
    if (!clean) return;
    const groupId = `group:${clean}`;
    setSubmitting(true);
    try {
      await onGrant(groupId, 'user:admin', 'member', 'grant');
      setSelectedGroup(groupId);
      setNewCircleName('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddMember = async () => {
    if (!newMemberEmail.trim() || !activeGroup) return;
    setSubmitting(true);
    try {
      await onGrant(activeGroup, newMemberEmail.trim(), 'member', 'grant');
      setNewMemberEmail('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Flex align="start" gap={5} className="iam-split">
      {/* Left Groups List */}
      <div className="iam-sidebar">
        <div className="ui-row ui-gap-2">
          <Input
            type="text"
            placeholder="New circle (e.g. team)"
            value={newCircleName}
            onChange={(e) => setNewCircleName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateCircle();
            }}
            aria-label="New circle name"
            className="ui-grow"
          />
          <Button
            size="sm"
            variant="primary"
            disabled={submitting || !newCircleName.trim()}
            onClick={handleCreateCircle}
            title="Create circle"
          >
            +
          </Button>
        </div>

        <div className="iam-list">
          {groups.map((g) => {
            const isSelected = g === activeGroup;
            return (
              <button
                key={g}
                className={['iam-list-item', isSelected ? 'iam-list-item--active' : ''].filter(Boolean).join(' ')}
                onClick={() => setSelectedGroup(g)}
              >
                <span aria-hidden="true">👥</span>
                <span className="iam-list-item__text">{g.replace('group:', '')}</span>
              </button>
            );
          })}
          {groups.length === 0 && (
            <div className="iam-empty">No circles found yet. Create one above!</div>
          )}
        </div>
      </div>

      {/* Right Detail Pane */}
      <div className="iam-pane">
        {activeGroup ? (
          <>
            {/* Group Header */}
            <div className="iam-user-card">
              <span className="iam-avatar iam-avatar--circle iam-avatar--lg" aria-hidden="true">👥</span>
              <div>
                <h2 className="iam-entity-title">{activeGroup}</h2>
                <span className="iam-mono iam-muted iam-copy-xs">
                  {memberTuples.length} direct members
                </span>
              </div>
            </div>

            {/* Add Member */}
            <div className="iam-grant">
              <h4 className="iam-section-title">Add Member to Circle</h4>
              <div className="ui-row ui-gap-2 ui-wrap">
                <Input
                  type="email"
                  placeholder="user:<dummy_mail>"
                  value={newMemberEmail}
                  onChange={(e) => setNewMemberEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddMember();
                  }}
                  aria-label="Member email or principal"
                  className="ui-grow"
                />
                <Button
                  variant="primary"
                  disabled={submitting || !newMemberEmail.trim()}
                  onClick={handleAddMember}
                >
                  Add Member
                </Button>
              </div>
            </div>

            {/* Members List */}
            <div>
              <h4 className="iam-h4">Circle Members</h4>
              <div className="iam-list-sm">
                {memberTuples.length === 0 ? (
                  <div className="iam-empty">No members added to this circle yet.</div>
                ) : (
                  memberTuples.map((m, idx) => (
                    <div
                      key={`${m.user}-${idx}`}
                      className="iam-list-row"
                    >
                      <span>👤 {m.user}</span>
                      <button
                        className="iam-revoke"
                        onClick={() => onGrant(activeGroup, m.user, 'member', 'revoke')}
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Resources Shared with this Circle */}
            <div>
              <h4 className="iam-h4">Resources Accessible to this Circle</h4>
              <div className="iam-list-sm">
                {resTuples.length === 0 ? (
                  <div className="iam-empty">No resources explicitly assigned to this circle yet.</div>
                ) : (
                  resTuples.map((rt, idx) => {
                    const resObj = resources.find(
                      (r) => `${r.type}:${r.id}` === rt.object || r.id === rt.object
                    );
                    return (
                      <div
                        key={`${rt.object}-${rt.relation}-${idx}`}
                        className="iam-list-row"
                      >
                        <span>📄 {resObj?.title || rt.object}</span>
                        <PermissionBadge relation={rt.relation} />
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="iam-empty iam-empty-lg">
            Select or create a circle.
          </div>
        )}
      </div>
    </Flex>
  );
};
