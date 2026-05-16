/**
 * PeriodSelector – searchable dropdown with year-grouped options.
 *
 * Replaces the flat <Select> in AppShell to handle dozens / hundreds of periods.
 */
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Input, makeStyles, tokens } from '@fluentui/react-components';
import {
  ChevronDownRegular,
  LockClosedRegular,
  SearchRegular,
} from '@fluentui/react-icons';
import type { Period } from '../types';
import { MONTH_NAMES, MONTH_SHORT } from '../utils/format';

export interface PeriodSelectorProps {
  periods: Period[];
  selectedId: string;
  onSelect: (id: string) => void;
  align?: 'left' | 'right';
}

export function PeriodSelector({ periods, selectedId, onSelect, align = 'left' }: PeriodSelectorProps) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // ── close on outside click ───────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── selected period label ────────────────────────────────────
  const selected = useMemo(() => periods.find((p) => p.id === selectedId), [periods, selectedId]);
  const triggerLabel = selected
    ? `${MONTH_SHORT[selected.month - 1]} ${selected.year}`
    : 'Select period';

  // ── filter + group by year (descending) ──────────────────────
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? periods.filter((p) => {
          const label = `${MONTH_NAMES[p.month - 1]} ${p.year} ${p.status}`.toLowerCase();
          return label.includes(q);
        })
      : periods;

    const map = new Map<number, Period[]>();
    for (const p of filtered) {
      let arr = map.get(p.year);
      if (!arr) { arr = []; map.set(p.year, arr); }
      arr.push(p);
    }
    // sort years descending, months ascending within each year
    const years = [...map.keys()].sort((a, b) => b - a);
    return years.map((y) => ({
      year: y,
      periods: map.get(y)!.sort((a, b) => a.month - b.month),
    }));
  }, [periods, query]);

  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
      setOpen(false);
      setQuery('');
    },
    [onSelect],
  );

  return (
    <div ref={containerRef} className={styles.root}>
      {/* trigger */}
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={styles.triggerLabel}>
          {triggerLabel}
          {selected && (
            <span className={selected.status === 'locked' ? styles.statusLocked : styles.statusOpen}>
              {selected.status === 'locked' ? <LockClosedRegular fontSize={12} /> : null}
              {' '}{selected.status}
            </span>
          )}
        </span>
        <ChevronDownRegular
          fontSize={14}
          className={open ? styles.chevronOpen : styles.chevron}
        />
      </button>

      {/* dropdown */}
      {open && (
        <div className={styles.dropdown} role="listbox" style={align === 'right' ? { left: 'auto', right: 0 } : undefined}>
          <div className={styles.searchBox}>
            <Input
              contentBefore={<SearchRegular fontSize={16} />}
              placeholder="Search periods…"
              value={query}
              onChange={(_, d) => setQuery(d.value)}
              autoFocus
              size="small"
              style={{ width: '100%' }}
            />
          </div>

          <div className={styles.optionsList}>
            {grouped.length === 0 && (
              <div className={styles.empty}>No matching periods</div>
            )}
            {grouped.map((g) => (
              <div key={g.year}>
                <div className={styles.yearHeader}>{g.year}</div>
                {g.periods.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={p.id === selectedId}
                    className={`${styles.option} ${p.id === selectedId ? styles.optionSelected : ''}`}
                    onClick={() => handleSelect(p.id)}
                  >
                    <span>{MONTH_NAMES[p.month - 1]}</span>
                    <span className={p.status === 'locked' ? styles.statusLocked : styles.statusOpen}>
                      {p.status === 'locked' && <LockClosedRegular fontSize={12} />}
                      {' '}{p.status}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── styles ───────────────────────────────────────────────────── */
const useStyles = makeStyles({
  root: {
    position: 'relative',
    display: 'inline-block',
  },
  trigger: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    background: tokens.colorNeutralBackground1,
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground1,
    transitionProperty: 'border-color, box-shadow',
    transitionDuration: '0.15s',
    ':hover': {
      border: `1px solid ${tokens.colorBrandForeground1}`,
    },
    ':focus-visible': {
      outlineWidth: '2px',
      outlineStyle: 'solid',
      outlineOffset: '1px',
    },
  },
  triggerLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
  },
  chevron: {
    transition: 'transform 0.2s',
    transform: 'rotate(0deg)',
  },
  chevronOpen: {
    transition: 'transform 0.2s',
    transform: 'rotate(180deg)',
  },
  dropdown: {
    position: 'absolute',
    left: 0,
    top: 'calc(100% + 4px)',
    minWidth: '240px',
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    boxShadow: tokens.shadow16,
    zIndex: 9999,
    overflow: 'hidden',
  },
  searchBox: {
    padding: tokens.spacingHorizontalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  optionsList: {
    maxHeight: '320px',
    overflowY: 'auto',
    padding: `${tokens.spacingVerticalXS} 0`,
  },
  yearHeader: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    position: 'sticky' as const,
    top: 0,
    backgroundColor: tokens.colorNeutralBackground1,
    zIndex: 1,
  },
  option: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground1,
    textAlign: 'left',
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  optionSelected: {
    backgroundColor: tokens.colorBrandBackground2,
    fontWeight: tokens.fontWeightSemibold,
    ':hover': {
      backgroundColor: tokens.colorBrandBackground2Hover,
    },
  },
  statusOpen: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorPaletteGreenForeground1,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '2px',
  },
  statusLocked: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '2px',
  },
  empty: {
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    textAlign: 'center' as const,
  },
});
