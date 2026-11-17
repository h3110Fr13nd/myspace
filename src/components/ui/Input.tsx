import React from 'react';

export interface FieldProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
}

interface FieldIds {
  htmlFor?: string;
  hintId?: string;
  errorId?: string;
}

const Field: React.FC<FieldProps & FieldIds> = ({ label, hint, error, htmlFor, hintId, errorId }) => (
  <>
    {label !== undefined && <label htmlFor={htmlFor} className="ui-field__label">{label}</label>}
    {hint !== undefined && <span id={hintId} className="ui-field__hint">{hint}</span>}
    {error !== undefined && <span id={errorId} className="ui-field__error" role="alert">{error}</span>}
  </>
);

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement>, FieldProps {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, error, className, id, ...rest }, ref) => {
    const generatedId = React.useId();
    const fieldId = id ?? generatedId;
    const hintId = hint !== undefined ? `${fieldId}-hint` : undefined;
    const errorId = error !== undefined ? `${fieldId}-error` : undefined;
    const describedBy = [rest['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined;
    const invalid = error !== undefined ? true : rest['aria-invalid'];
    return (
      <div className={['ui-field', className ?? ''].filter(Boolean).join(' ')}>
        <Field htmlFor={fieldId} hintId={hintId} errorId={errorId} label={label} hint={hint} error={error} />
        <input ref={ref} {...rest} id={fieldId} aria-describedby={describedBy} aria-invalid={invalid} className="ui-input" />
      </div>
    );
  }
);
Input.displayName = 'Input';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement>, FieldProps {
  options: { value: string; label: string }[];
}

export const Select: React.FC<SelectProps> = ({ label, hint, error, className, id, options, ...rest }) => {
  const generatedId = React.useId();
  const fieldId = id ?? generatedId;
  const hintId = hint !== undefined ? `${fieldId}-hint` : undefined;
  const errorId = error !== undefined ? `${fieldId}-error` : undefined;
  const describedBy = [rest['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined;
  const invalid = error !== undefined ? true : rest['aria-invalid'];
  return (
    <div className={['ui-field', className ?? ''].filter(Boolean).join(' ')}>
      <Field htmlFor={fieldId} hintId={hintId} errorId={errorId} label={label} hint={hint} error={error} />
      <select {...rest} id={fieldId} aria-describedby={describedBy} aria-invalid={invalid} className="ui-select">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
};

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement>, FieldProps {}

export const TextArea: React.FC<TextAreaProps> = ({ label, hint, error, className, id, ...rest }) => {
  const generatedId = React.useId();
  const fieldId = id ?? generatedId;
  const hintId = hint !== undefined ? `${fieldId}-hint` : undefined;
  const errorId = error !== undefined ? `${fieldId}-error` : undefined;
  const describedBy = [rest['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined;
  const invalid = error !== undefined ? true : rest['aria-invalid'];
  return (
    <div className={['ui-field', className ?? ''].filter(Boolean).join(' ')}>
      <Field htmlFor={fieldId} hintId={hintId} errorId={errorId} label={label} hint={hint} error={error} />
      <textarea {...rest} id={fieldId} aria-describedby={describedBy} aria-invalid={invalid} className="ui-textarea" />
    </div>
  );
};
