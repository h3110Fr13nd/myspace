import React, { useState } from 'react';
import { ChevronDown, RotateCw, Trash2 } from 'lucide-react';

export interface BlockChromeProps {
  icon: string | React.ReactNode;
  title: string;
  subtitle?: string;
  badge?: string;
  accentColor?: string;
  actions?: React.ReactNode;
  onDelete?: () => void;
  onRefresh?: () => void;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Universal DRY Block Chrome & Container Shell
 * Standardizes aesthetic glassmorphism, action toolbar, collapse states,
 * and deletion across all custom block node extensions.
 */
export const BlockChrome: React.FC<BlockChromeProps> = ({
  icon,
  title,
  subtitle,
  badge,
  accentColor = 'var(--accent-cyan)',
  actions,
  onDelete,
  onRefresh,
  collapsible = true,
  defaultCollapsed = false,
  children,
  className = '',
}) => {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div
      className={`block-chrome-shell ${className}`}
      contentEditable={false}
      style={{
        margin: '1.5rem 0',
        borderRadius: '12px',
        border: `1px solid ${accentColor ? `${accentColor}44` : 'rgba(255, 255, 255, 0.12)'}`,
        background: 'rgba(10, 15, 28, 0.85)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        boxShadow: `0 8px 30px rgba(0, 0, 0, 0.5), inset 0 0 15px ${accentColor ? `${accentColor}11` : 'rgba(255, 255, 255, 0.02)'}`,
        overflow: 'hidden',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
      }}
    >
      {/* HEADER BAR */}
      <div
        style={{
          padding: '8px 14px',
          background: accentColor ? `${accentColor}14` : 'rgba(255, 255, 255, 0.04)',
          borderBottom: collapsed ? 'none' : `1px solid ${accentColor ? `${accentColor}26` : 'rgba(255, 255, 255, 0.08)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          userSelect: 'none',
        }}
      >
        {/* Left Info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          {collapsible && (
            <button
              onClick={() => setCollapsed(!collapsed)}
              title={collapsed ? 'Expand block' : 'Collapse block'}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '2px',
                display: 'flex',
                alignItems: 'center',
                transition: 'transform 0.2s ease',
                transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
              }}
            >
              <ChevronDown size={14} />
            </button>
          )}

          <span style={{ fontSize: '1.05rem', lineHeight: 1 }}>{icon}</span>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minWidth: 0 }}>
            <span
              style={{
                fontSize: '0.8rem',
                fontWeight: 700,
                color: accentColor,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                whiteSpace: 'nowrap',
              }}
            >
              {title}
            </span>

            {badge && (
              <span
                style={{
                  fontSize: '0.68rem',
                  padding: '1px 6px',
                  borderRadius: '4px',
                  background: `${accentColor}22`,
                  border: `1px solid ${accentColor}44`,
                  color: '#fff',
                  fontWeight: 600,
                }}
              >
                {badge}
              </span>
            )}

            {subtitle && (
              <span
                style={{
                  fontSize: '0.74rem',
                  color: 'var(--text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {subtitle}
              </span>
            )}
          </div>
        </div>

        {/* Right Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {actions}

          {onRefresh && (
            <button
              onClick={onRefresh}
              title="Refresh component data"
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: 'var(--text-secondary)',
                borderRadius: '6px',
                padding: '4px 8px',
                fontSize: '0.75rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                transition: 'all 0.15s ease',
              }}
            >
              <RotateCw size={12} />
            </button>
          )}

          {onDelete && (
            <button
              onClick={onDelete}
              title="Delete block"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '4px',
                display: 'inline-flex',
                alignItems: 'center',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#ef4444')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = 'var(--text-muted)')}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* BLOCK BODY */}
      {!collapsed && <div className="block-chrome-body">{children}</div>}
    </div>
  );
};
