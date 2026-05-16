/**
 * Searchable filter: type to filter options by text (contains match).
 * Used for Project, Resource, Cost Center filters in Demand/Supply.
 */
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Input, makeStyles, tokens } from '@fluentui/react-components';

export interface SearchableFilterOption {
  id: string;
  label: string;
}

export interface SearchableFilterProps {
  options: SearchableFilterOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  allLabel?: string;
  style?: React.CSSProperties;
}

export function SearchableFilter({
  options,
  value,
  onChange,
  placeholder = 'Type to search...',
  allLabel = 'All',
  style,
}: SearchableFilterProps) {
  const styles = useStyles();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => options.find(o => o.id === value), [options, value]);
  const displayValue = open || focused ? query : (selected ? selected.label : '');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 80);
    return options.filter(o =>
      o.label.toLowerCase().includes(q)
    ).slice(0, 80);
  }, [options, query]);

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
    <div ref={containerRef} className={styles.root} style={style}>
      <Input
        value={displayValue}
        onChange={(_, d) => {
          setQuery(d.value);
          setOpen(true);
          if (!d.value) onChange('');
        }}
        onFocus={() => { setFocused(true); setOpen(true); if (!query && value) setQuery(selected?.label ?? ''); }}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {open && (
        <ul className={styles.list} role="listbox">
          <li
            className={styles.option}
            role="option"
            aria-selected={!value}
            onMouseDown={(e) => { e.preventDefault(); onChange(''); setQuery(''); setOpen(false); }}
          >
            {allLabel}
          </li>
          {filtered.map(o => (
            <li
              key={o.id}
              role="option"
              aria-selected={o.id === value}
              className={styles.option}
              onMouseDown={(e) => { e.preventDefault(); onChange(o.id); setQuery(''); setOpen(false); }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const useStyles = makeStyles({
  root: { position: 'relative', width: '100%', minWidth: '180px' },
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
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  option: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase300,
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
});
