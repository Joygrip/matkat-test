/**
 * Searchable placeholder picker: type to filter by name; select to set placeholder_id.
 */
import { useState, useMemo, useRef, useEffect } from 'react';
import { Input, makeStyles, tokens } from '@fluentui/react-components';
import type { Placeholder } from '../api/admin';

const useStyles = makeStyles({
  root: { position: 'relative', width: '100%' },
  list: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '100%',
    marginTop: '2px',
    maxHeight: '220px',
    overflowY: 'auto',
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    boxShadow: tokens.shadow16,
    zIndex: 1000,
  },
  option: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase300,
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
});

export interface PlaceholderPickerProps {
  placeholders: Placeholder[];
  value: string;
  onChange: (placeholderId: string) => void;
  placeholder?: string;
}

export function PlaceholderPicker({
  placeholders,
  value,
  onChange,
  placeholder = 'Type placeholder name...',
}: PlaceholderPickerProps) {
  const styles = useStyles();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => placeholders.find(p => p.id === value), [placeholders, value]);
  const displayValue = open || focused ? query : (selected ? selected.name : '');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return placeholders.slice(0, 50);
    return placeholders.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.cost_center_name != null && p.cost_center_name.toLowerCase().includes(q))
    ).slice(0, 50);
  }, [placeholders, query]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFocused(false);
      }
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  return (
    <div ref={containerRef} className={styles.root}>
      <Input
        value={displayValue}
        onChange={(_, d) => {
          setQuery(d.value);
          setOpen(true);
          if (!d.value) onChange('');
        }}
        onFocus={() => { setFocused(true); setOpen(true); if (!query && value) setQuery(selected?.name ?? ''); }}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {open && (
        <ul className={styles.list} role="listbox">
          {filtered.length === 0 ? (
            <li className={styles.option} style={{ cursor: 'default', color: tokens.colorNeutralForeground3 }}>No matches</li>
          ) : (
            filtered.map(p => (
              <li
                key={p.id}
                role="option"
                aria-selected={p.id === value}
                className={styles.option}
                onMouseDown={(e) => { e.preventDefault(); onChange(p.id); setQuery(''); setOpen(false); }}
              >
                {p.name}{p.cost_center_name ? ` – ${p.cost_center_name}` : ''}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
