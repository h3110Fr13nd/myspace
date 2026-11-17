import React from 'react';
import { ENTITY_META } from './constants';
import { Tabs } from '../ui/Tabs';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Flex } from '../ui/Stack';
import { SectionHeader } from '../ui/SectionHeader';

interface GraphDrawerProps {
  isOpen: boolean;
  activeTab: 'physics' | 'filters' | 'display';
  setActiveTab: (tab: 'physics' | 'filters' | 'display') => void;
  repulsion: number;
  setRepulsion: (val: number) => void;
  gravity: number;
  setGravity: (val: number) => void;
  linkDistance: number;
  setLinkDistance: (val: number) => void;
  collisionPadding: number;
  setCollisionPadding: (val: number) => void;
  onResetPhysics: () => void;
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  hideOrphans: boolean;
  setHideOrphans: (val: boolean) => void;
  availableTypesWithCounts: Record<string, number>;
  selectedTypes: Set<string>;
  onToggleType: (typeKey: string) => void;
  onSelectAllTypes: () => void;
  onClearAllTypes: () => void;
  zoomBreakpoint: number;
  setZoomBreakpoint: (val: number) => void;
  showLabels: 'always' | 'hover';
  setShowLabels: (val: 'always' | 'hover') => void;
}

export const GraphDrawer: React.FC<GraphDrawerProps> = ({
  isOpen,
  activeTab,
  setActiveTab,
  repulsion,
  setRepulsion,
  gravity,
  setGravity,
  linkDistance,
  setLinkDistance,
  collisionPadding,
  setCollisionPadding,
  onResetPhysics,
  searchQuery,
  setSearchQuery,
  hideOrphans,
  setHideOrphans,
  availableTypesWithCounts,
  selectedTypes,
  onToggleType,
  onSelectAllTypes,
  onClearAllTypes,
  zoomBreakpoint,
  setZoomBreakpoint,
  showLabels,
  setShowLabels,
}) => {
  if (!isOpen) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      <Tabs
        items={[
          { value: 'physics', label: '🎛️ Physics' },
          { value: 'filters', label: '🔍 Filters' },
          { value: 'display', label: '👁️ Display' },
        ]}
        value={activeTab}
        onChange={setActiveTab}
        aria-label="Graph controls"
      />

      <div style={{ padding: '14px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {activeTab === 'physics' && (
          <>
            <div>
              <SectionHeader title="Repulsion (Charge)" subtitle={`${repulsion}`} />
              <input
                type="range"
                min="-800"
                max="-50"
                step="10"
                value={repulsion}
                onChange={(e) => setRepulsion(Number(e.target.value))}
                style={{ width: '100%', cursor: 'pointer', accentColor: 'var(--accent-cyan-bright)' }}
              />
              <Flex justify="between" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                <span>Tight cluster (-50)</span>
                <span>Wide spread (-800)</span>
              </Flex>
            </div>

            <div>
              <SectionHeader title="Center Gravity" subtitle={gravity.toFixed(2)} />
              <input
                type="range"
                min="0.01"
                max="0.40"
                step="0.01"
                value={gravity}
                onChange={(e) => setGravity(Number(e.target.value))}
                style={{ width: '100%', cursor: 'pointer', accentColor: 'var(--accent-cyan-bright)' }}
              />
              <Flex justify="between" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                <span>Floating loose (0.01)</span>
                <span>Dense center (0.40)</span>
              </Flex>
            </div>

            <div>
              <SectionHeader title="Link Distance" subtitle={`${linkDistance}px`} />
              <input
                type="range"
                min="30"
                max="250"
                step="5"
                value={linkDistance}
                onChange={(e) => setLinkDistance(Number(e.target.value))}
                style={{ width: '100%', cursor: 'pointer', accentColor: 'var(--accent-cyan-bright)' }}
              />
            </div>

            <div>
              <SectionHeader title="Collision Radius" subtitle={`+${collisionPadding}px`} />
              <input
                type="range"
                min="4"
                max="40"
                step="2"
                value={collisionPadding}
                onChange={(e) => setCollisionPadding(Number(e.target.value))}
                style={{ width: '100%', cursor: 'pointer', accentColor: 'var(--accent-cyan-bright)' }}
              />
            </div>

            <Button variant="ghost" size="sm" onClick={onResetPhysics} className="graph-drawer-reset-btn">
              ↺ Reset Physics to Defaults
            </Button>
          </>
        )}

        {activeTab === 'filters' && (
          <>
            <div>
              <SectionHeader title="Search Node Title" />
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Filter nodes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="ui-input"
                  style={{
                    width: '100%',
                    padding: '8px 28px 8px 10px',
                    background: 'var(--control-bg)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontSize: 'var(--text-md)',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                {searchQuery && (
                  <Button variant="ghost" size="sm" onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)' }}>
                    ✕
                  </Button>
                )}
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 10px',
                background: 'var(--control-bg)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-glass)',
              }}
            >
              <div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', fontWeight: 600 }}>Hide Orphan Nodes</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Omit nodes with 0 connections</div>
              </div>
              <input
                type="checkbox"
                checked={hideOrphans}
                onChange={(e) => setHideOrphans(e.target.checked)}
                style={{ cursor: 'pointer', accentColor: 'var(--accent-cyan-bright)', width: '16px', height: '16px' }}
              />
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span
                  style={{
                    fontSize: 'var(--text-xs)',
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  Entity Types
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Button variant="ghost" size="sm" onClick={onSelectAllTypes} style={{ padding: '2px 6px', fontSize: '11px', height: '22px' }}>
                    All
                  </Button>
                  <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>•</span>
                  <Button variant="ghost" size="sm" onClick={onClearAllTypes} style={{ padding: '2px 6px', fontSize: '11px', height: '22px' }}>
                    None
                  </Button>
                </div>
              </div>

              <div className="graph-filter-list">
                {Object.entries(availableTypesWithCounts).map(([typeKey, count]) => {
                  const meta = ENTITY_META[typeKey] || {
                    label: typeKey.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
                    icon: '📄',
                    color: 'var(--accent-primary)',
                  };
                  const isChecked = selectedTypes.has(typeKey);
                  return (
                    <label
                      key={typeKey}
                      className={`graph-filter-item ${isChecked ? 'graph-filter-item--active' : 'graph-filter-item--inactive'}`}
                    >
                      <div className="graph-filter-item__left">
                        <span
                          className="graph-filter-item__dot"
                          style={{
                            background: meta.color,
                            boxShadow: isChecked ? `0 0 6px ${meta.color}` : 'none',
                          }}
                        />
                        <span className="graph-filter-item__icon">{meta.icon}</span>
                        <span className="graph-filter-item__label">{meta.label}</span>
                      </div>
                      <div className="graph-filter-item__right">
                        <span className="graph-filter-item__count">{count}</span>
                        <input
                          type="checkbox"
                          className="graph-filter-item__checkbox"
                          checked={isChecked}
                          onChange={() => onToggleType(typeKey)}
                          style={{ accentColor: meta.color }}
                        />
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {activeTab === 'display' && (
          <>
            <div>
              <SectionHeader title="Size Breakpoint Scale" subtitle={`${zoomBreakpoint.toFixed(1)}x`} />
              <input
                type="range"
                min="0.4"
                max="3.0"
                step="0.1"
                value={zoomBreakpoint}
                onChange={(e) => setZoomBreakpoint(Number(e.target.value))}
                style={{ width: '100%', cursor: 'pointer', accentColor: 'var(--accent-cyan-bright)' }}
              />
              <p style={{ margin: '4px 0 0 0', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                When zooming in past this scale, node circles and text labels freeze at fixed screen dimensions rather than expanding. Edge widths remain permanently crisp hairline strokes via vector-effect non-scaling stroke.
              </p>
            </div>

            <div>
              <SectionHeader title="Label Visibility" />
              <Flex gap={2}>
                <Button
                  variant={showLabels === 'always' ? 'cybergradient' : 'ghost'}
                  size="sm"
                  onClick={() => setShowLabels('always')}
                  style={{ flex: 1 }}
                >
                  Always Visible
                </Button>
                <Button
                  variant={showLabels === 'hover' ? 'cybergradient' : 'ghost'}
                  size="sm"
                  onClick={() => setShowLabels('hover')}
                  style={{ flex: 1 }}
                >
                  On Hover Only
                </Button>
              </Flex>
            </div>
          </>
        )}
      </div>
    </div>
  );
};