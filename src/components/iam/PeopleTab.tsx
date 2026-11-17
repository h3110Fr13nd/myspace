import React, { useState } from 'react';
import type { LiveTuple, ResourceItem } from './types';
import { PermissionBadge } from './PermissionBadge';
import { Flex, Input } from '../ui';

interface PeopleTabProps {
  resources: ResourceItem[];
  tuples: LiveTuple[];
}

export const PeopleTab: React.FC<PeopleTabProps> = ({ resources, tuples }) => {
  const [searchQuery, setSearchQuery] = useState('');

  // Extract all unique users
  const usersSet = new Set<string>();
  tuples.forEach((t) => {
    if (t.user.startsWith('user:') && t.user !== 'user:*') usersSet.add(t.user);
  });
  resources.forEach((r) => {
    if (r.owner_id && r.owner_id.startsWith('user:')) usersSet.add(r.owner_id);
  });

  const allUsers = Array.from(usersSet).sort();
  const filteredUsers = allUsers.filter((u) =>
    u.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const [selectedUser, setSelectedUser] = useState<string>(allUsers[0] || '');
  const activeUser = selectedUser || allUsers[0] || '';

  // Circles this user belongs to
  const userGroups = tuples
    .filter(
      (t) =>
        t.user === activeUser &&
        t.object.startsWith('group:') &&
        t.relation === 'member'
    )
    .map((t) => t.object);

  // Direct Resource Grants
  const grants = tuples.filter(
    (t) =>
      t.user === activeUser &&
      !t.object.startsWith('group:') &&
      !t.relation.startsWith('denied_')
  );

  // Explicit Denials
  const denials = tuples.filter(
    (t) => t.user === activeUser && t.relation.startsWith('denied_')
  );

  return (
    <Flex align="start" gap={5} className="iam-split">
      {/* Left Users List */}
      <div className="iam-sidebar">
        <Input
          type="text"
          placeholder="Search users..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search users"
        />

        <div className="iam-list">
          {filteredUsers.map((u) => {
            const isSelected = u === activeUser;
            return (
              <button
                key={u}
                className={['iam-list-item', isSelected ? 'iam-list-item--active' : ''].filter(Boolean).join(' ')}
                onClick={() => setSelectedUser(u)}
              >
                <span aria-hidden="true">👤</span>
                <span className="iam-list-item__text">
                  {u.replace('user:', '')}
                </span>
              </button>
            );
          })}
          {filteredUsers.length === 0 && (
            <div className="iam-empty">No matching users.</div>
          )}
        </div>
      </div>

      {/* Right User Audit Details */}
      <div className="iam-pane">
        {activeUser ? (
          <>
            {/* Header */}
            <div className="iam-user-card">
              <div className="iam-user-avatar">👤</div>
              <div>
                <h2 className="iam-entity-title">{activeUser}</h2>
                <span className="iam-muted iam-copy-xs">
                  Effective ReBAC Permissions Report
                </span>
              </div>
            </div>

            {/* Circles Membership */}
            <div>
              <h4 className="iam-h4">👥 Circles & Group Memberships</h4>
              <div className="iam-list-sm">
                {userGroups.length === 0 ? (
                  <div className="iam-empty">Not a member of any circles.</div>
                ) : (
                  userGroups.map((g) => (
                    <div key={g} className="iam-list-row">
                      <span>👥 {g}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Granted Resources */}
            <div>
              <h4 className="iam-h4">📄 Resources Granted Access</h4>
              <div className="iam-list-sm">
                {grants.length === 0 ? (
                  <div className="iam-empty">No direct resource grants.</div>
                ) : (
                  grants.map((g, idx) => {
                    const resObj = resources.find(
                      (r) => `${r.type}:${r.id}` === g.object || r.id === g.object
                    );
                    return (
                      <div
                        key={`${g.object}-${g.relation}-${idx}`}
                        className="iam-list-row"
                      >
                        <span>📄 {resObj?.title || g.object}</span>
                        <PermissionBadge relation={g.relation} />
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Explicit Denials */}
            <div>
              <h4 className="iam-h4 iam-deny-title">🚫 Explicit Blocks & Denials</h4>
              <div className="iam-list-sm">
                {denials.length === 0 ? (
                  <div className="iam-empty">No explicit blocks for this user.</div>
                ) : (
                  denials.map((d, idx) => {
                    const resObj = resources.find(
                      (r) => `${r.type}:${r.id}` === d.object || r.id === d.object
                    );
                    return (
                      <div
                        key={`${d.object}-${d.relation}-${idx}`}
                        className="iam-list-row iam-list-row--deny"
                      >
                        <span>🚫 {resObj?.title || d.object}</span>
                        <PermissionBadge relation={d.relation} />
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="iam-empty iam-empty-lg">
            No users available.
          </div>
        )}
      </div>
    </Flex>
  );
};
