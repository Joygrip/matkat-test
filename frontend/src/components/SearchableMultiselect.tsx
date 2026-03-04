/**
 * Searchable multiselect: type to filter options, click to toggle selection.
 * Used for Resources/Placeholders in bulk add (Supply, Demand).
 */
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Input, makeStyles, tokens } from '@fluentui/react-components';

export interface SearchableMultiselectOption {
  id: string;
  label: string;
}

export interface SearchableMultiselectProps {
  options: SearchableMultiselectOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}

export function SearchableMultiselect({
  options,
  value,
  onChange,
  placeholder = 'Type to search...',
  style,
}: SearchableMultiselectProps) {
  const styles = useStyles();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const displayValue = open || focused ? query : (value.length > 0 ? `${value.length} selected` : '');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 80);
    return options.filter(o =>
      o.label.toLowerCase().includes(q)
    ).slice(0, 80);
  }, [options, query]);

  const toggleOption = (id: string) => {
    const next = new Set(value);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onChange(Array.from(next));
  };

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
        }}
        onFocus={() => { setFocused(true); setOpen(true); }}
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
            filtered.map(o => (
              <li
                key={o.id}
                role="option"
                aria-selected={selectedSet.has(o.id)}
                className={styles.option}
                style={selectedSet.has(o.id) ? { backgroundColor: tokens.colorNeutralBackground1Selected } : undefined}
                onMouseDown={(e) => { e.preventDefault(); toggleOption(o.id); }}
              >
                {selectedSet.has(o.id) && '✓ '}{o.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

const useStyles = makeStyles({
  root: { position: 'relative', width: '100%', minWidth: 180 },
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
