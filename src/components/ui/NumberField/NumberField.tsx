import { useEffect, useId, useState } from 'react';
import { parseNumber } from '@/lib/number';
import { FieldLabel } from '../FieldLabel/FieldLabel';
import styles from './NumberField.module.css';

interface NumberFieldProps {
  label: string;
  hint?: string;
  value: number;
  min?: number;
  max?: number;
  suffix?: string;
  onChange: (value: number) => void;
}

// Inline numeric input; commits a clamped value on blur or Enter.
export function NumberField({
  label,
  hint,
  value,
  min = -Infinity,
  max = Infinity,
  suffix,
  onChange,
}: NumberFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const v = parseNumber(draft);
    if (v === null) return setDraft(String(value));
    const next = Math.min(max, Math.max(min, Math.round(v)));
    setDraft(String(next));
    if (next !== value) onChange(next);
  };

  return (
    <div className={styles.row}>
      <FieldLabel htmlFor={id} label={label} hint={hint} />
      <div className={styles.control}>
        <input
          id={id}
          className={styles.input}
          inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
        {suffix && <span className={styles.suffix}>{suffix}</span>}
      </div>
    </div>
  );
}
