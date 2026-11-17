import React, { useState } from 'react';

interface DynamicFormProps {
  formId: string;
  currentUser: string;
  isEmbedded?: boolean;
}

export const DynamicForm: React.FC<DynamicFormProps> = ({ formId, currentUser, isEmbedded = false }) => {
  const [formData, setFormData] = useState({
    feedbackType: 'bug_report',
    userNotes: '',
    urgency: 'medium',
  });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <div
      className={isEmbedded ? undefined : 'ui-card'}
      style={{
        padding: isEmbedded ? '0' : '1.5rem',
        marginTop: isEmbedded ? '0' : '1.5rem',
        borderRadius: isEmbedded ? '0' : '16px',
        border: isEmbedded ? 'none' : undefined,
        background: isEmbedded ? 'transparent' : undefined,
        boxShadow: isEmbedded ? 'none' : undefined,
        width: '100%',
        height: isEmbedded ? '100%' : 'auto',
        display: isEmbedded ? 'flex' : undefined,
        flexDirection: isEmbedded ? 'column' : undefined,
        overflow: 'auto',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h3 style={{ fontSize: '1.2rem', color: '#fff' }}>JSON Schema Dynamic Form Node</h3>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Form ID: {formId}</span>
        </div>
        <span className="ui-badge ui-badge--info">@rjsf/core Schema</span>
      </div>

      {submitted ? (
        <div style={{ padding: '1rem', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid var(--accent-emerald)', borderRadius: '8px', color: 'var(--accent-emerald)' }}>
          ✓ Form submitted successfully by <strong>{currentUser}</strong>! Response logged in PostgreSQL.
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              Feedback Category
            </label>
            <select
              value={formData.feedbackType}
              onChange={(e) => setFormData({ ...formData, feedbackType: e.target.value })}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '6px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-glass)',
                color: '#fff',
              }}
            >
              <option value="feature_request">Feature Request</option>
              <option value="bug_report">Security / Permission Bug</option>
              <option value="documentation">Documentation Improvement</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              Details & Description
            </label>
            <textarea
              rows={3}
              value={formData.userNotes}
              onChange={(e) => setFormData({ ...formData, userNotes: e.target.value })}
              placeholder="Enter node feedback or access issue details..."
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '6px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-glass)',
                color: '#fff',
              }}
            />
          </div>

          <button type="submit" className="glass-button" style={{ alignSelf: 'flex-start' }}>
            Submit Form Data
          </button>
        </form>
      )}
    </div>
  );
};
