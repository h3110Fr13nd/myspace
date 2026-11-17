import React, { useState } from 'react';
import type { LiveTuple } from './types';
import { PermissionBadge } from './PermissionBadge';
import { Button, Flex, Input, Stack } from '../ui';

interface TupleInspectorTabProps {
  tuples: LiveTuple[];
  onGrant: (resource: string, principal: string, role: string, action?: 'grant' | 'revoke') => Promise<void>;
}

export const TupleInspectorTab: React.FC<TupleInspectorTabProps> = ({ tuples, onGrant }) => {
  const [filterSearch, setFilterSearch] = useState('');
  const [filterRelation, setFilterRelation] = useState('ALL');

  // Tuple Writer State
  const [rawUser, setRawUser] = useState('');
  const [rawRelation, setRawRelation] = useState('');
  const [rawObject, setRawObject] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const filteredTuples = tuples.filter((t) => {
    const q = filterSearch.toLowerCase();
    const matchesSearch =
      t.user.toLowerCase().includes(q) ||
      t.relation.toLowerCase().includes(q) ||
      t.object.toLowerCase().includes(q);
    const matchesRel = filterRelation === 'ALL' || t.relation === filterRelation;
    return matchesSearch && matchesRel;
  });

  const handleWrite = async () => {
    if (!rawUser.trim() || !rawRelation.trim() || !rawObject.trim()) return;
    setSubmitting(true);
    try {
      await onGrant(rawObject.trim(), rawUser.trim(), rawRelation.trim(), 'grant');
      setRawUser('');
      setRawRelation('');
      setRawObject('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Stack gap={5}>
      {/* Tuple Writer */}
      <div className="iam-panel iam-panel--sm iam-panel--pad">
        <h4 className="iam-widget-title">⚡ Write Direct OpenFGA Tuple</h4>
        <Flex gap={2} wrap>
          <Input
            type="text"
            placeholder="user:alice or group:team#member"
            value={rawUser}
            onChange={(e) => setRawUser(e.target.value)}
            aria-label="Tuple user / principal"
            className="ui-grow iam-min180"
          />
          <Input
            type="text"
            placeholder="viewer / editor / member / denied_viewer"
            value={rawRelation}
            onChange={(e) => setRawRelation(e.target.value)}
            aria-label="Tuple relation"
            className="ui-grow iam-min160"
          />
          <Input
            type="text"
            placeholder="document:my-doc or group:team"
            value={rawObject}
            onChange={(e) => setRawObject(e.target.value)}
            aria-label="Tuple object"
            className="ui-grow iam-min180"
          />
          <Button
            variant="primary"
            disabled={submitting || !rawUser.trim() || !rawRelation.trim() || !rawObject.trim()}
            loading={submitting}
            onClick={handleWrite}
          >
            {submitting ? 'Writing...' : 'Write Tuple'}
          </Button>
        </Flex>
      </div>

      {/* Filter Controls */}
      <Flex gap={3} align="center" justify="between" wrap>
        <Input
          type="text"
          placeholder="Filter tuples by user, relation, or object..."
          value={filterSearch}
          onChange={(e) => setFilterSearch(e.target.value)}
          aria-label="Filter tuples"
          className="iam-filterwidth"
        />
        <select
          value={filterRelation}
          onChange={(e) => setFilterRelation(e.target.value)}
          aria-label="Filter by relation"
          className="ui-select iam-select-role"
        >
          <option value="ALL">All Relations ({tuples.length})</option>
          <option value="viewer">viewer</option>
          <option value="editor">editor</option>
          <option value="owner">owner</option>
          <option value="member">member</option>
          <option value="denied_viewer">denied_viewer (Block)</option>
          <option value="denied_editor">denied_editor (Block)</option>
          <option value="parent_folder">parent_folder</option>
          <option value="parent_space">parent_space</option>
        </select>
      </Flex>

      {/* Tuples Table */}
      <div className="iam-tablewrap iam-tuplescroll">
        <table className="iam-table">
          <thead>
            <tr>
              <th>User / Principal</th>
              <th>Relation</th>
              <th>Object</th>
              <th className="iam-th-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredTuples.map((t, idx) => (
              <tr key={`${t.user}-${t.relation}-${t.object}-${idx}`}>
                <td className="iam-mono">{t.user}</td>
                <td>
                  <PermissionBadge relation={t.relation} />
                </td>
                <td className="iam-mono iam-objcell">{t.object}</td>
                <td className="iam-th-right">
                  <button
                    onClick={() => onGrant(t.object, t.user, t.relation, 'revoke')}
                    className="iam-revoke"
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
            {filteredTuples.length === 0 && (
              <tr>
                <td colSpan={4} className="iam-empty iam-td-empty">
                  No tuples match your filter criteria.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Stack>
  );
};
