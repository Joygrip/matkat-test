/**
 * Searchable resource picker: type name or initials to filter; select to set resource_id.
 */
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Input, makeStyles, tokens } from '@fluentui/react-components';
import type { Resource } from '../api/admin';

const useStyles = makeStyles({
  root: { position: 'relative', width: '100%' },
  list: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '100%',
    marginTop: 2,
    maxHeight: 220,
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

export interface ResourcePickerProps {
  resources: Resource[];
  value: string;
  onChange: (resourceId: string) => void;
  placeholder?: string;
}

export function ResourcePicker({ resources, value, onChange, placeholder = 'Type name or initials...' }: ResourcePickerProps) {
  const styles = useStyles();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => resources.find(r => r.id === value), [resources, value]);
  const displayValue = open || focused ? query : (selected ? (selected.initials ? `${selected.display_name} (${selected.initials})` : selected.display_name) : '');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return resources.slice(0, 50);
    return resources.filter(r =>
      r.display_name.toLowerCase().includes(q) ||
      (r.initials != null && r.initials.toLowerCase().includes(q))
    ).slice(0, 50);
  }, [resources, query]);

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
        onFocus={() => { setFocused(true); setOpen(true); if (!query && value) setQuery(selected?.display_name ?? ''); }}
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
            filtered.map(r => (
              <li
                key={r.id}
                role="option"
                aria-selected={r.id === value}
                className={styles.option}
                onMouseDown={(e) => { e.preventDefault(); onChange(r.id); setQuery(''); setOpen(false); }}
              >
                {r.display_name}{r.initials ? ` (${r.initials})` : ''}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
