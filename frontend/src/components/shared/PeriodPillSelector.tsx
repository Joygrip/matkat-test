import React, { useState, useEffect, useMemo, useRef } from 'react';
import { makeStyles, tokens } from '@fluentui/react-components';
import { Period } from '../../types/index';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const fmtPeriodShort = (p: Period) => `${MONTH_ABBR[p.month - 1]} '${String(p.year).slice(2)}`;
const fmtPeriodLong = (p: Period) => `${MONTH_FULL[p.month - 1]} ${p.year}`;

const LockIcon = ({ size = 10 }: { size?: number }) => (
  <svg
    width={size} height={size} viewBox="0 0 10 10" fill="currentColor"
    style={{ marginLeft: 3, opacity: 0.65, verticalAlign: 'middle', display: 'inline-block' }}
  >
    <path d="M7.5 4.5H7V3a2 2 0 0 0-4 0v1.5H2.5A.5.5 0 0 0 2 5v4a.5.5 0 0 0 .5.5h5A.5.5 0 0 0 8 9V5a.5.5 0 0 0-.5-.5zM4 3a1 1 0 0 1 2 0v1.5H4V3z" />
  </svg>
);

const useStyles = makeStyles({
  periodPills: {
    display: 'flex',
    gap: tokens.spacingHorizontalXS,
    flexWrap: 'wrap' as const,
    alignItems: 'center',
  },
  periodPill: {
    padding: `4px 10px`,
    height: '26px',
    borderRadius: '999px',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    cursor: 'pointer',
    fontFamily: 'inherit',
    userSelect: 'none' as const,
    display: 'flex',
    alignItems: 'center',
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground3,
    },
  },
  periodPillActive: {
    padding: `4px 10px`,
    height: '26px',
    borderRadius: '999px',
    border: '1px solid #1e3a5f',
    backgroundColor: '#1e3a5f',
    color: '#ffffff',
    fontSize: tokens.fontSizeBase200,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: tokens.fontWeightSemibold,
    userSelect: 'none' as const,
    display: 'flex',
    alignItems: 'center',
  },
  periodPillInRange: {
    padding: `4px 10px`,
    height: '26px',
    borderRadius: '999px',
    border: `1px solid #4a90d9`,
    backgroundColor: '#d0e3f7',
    color: '#1e3a5f',
    fontSize: tokens.fontSizeBase200,
    cursor: 'grabbing',
    fontFamily: 'inherit',
    fontWeight: tokens.fontWeightSemibold,
    userSelect: 'none' as const,
    display: 'flex',
    alignItems: 'center',
  },
  periodPillLocked: {
    padding: `4px 10px`,
    height: '26px',
    borderRadius: '999px',
    border: `1px solid #cfcfcc`,
    backgroundColor: tokens.colorNeutralBackground1,
    color: '#707070',
    fontSize: tokens.fontSizeBase200,
    cursor: 'pointer',
    fontFamily: 'inherit',
    userSelect: 'none' as const,
    display: 'flex',
    alignItems: 'center',
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground3,
    },
  },
  periodPillLockedActive: {
    padding: `4px 10px`,
    height: '26px',
    borderRadius: '999px',
    border: '1px solid #1e3a5f',
    backgroundColor: '#1e3a5f',
    color: '#ffffff',
    fontSize: tokens.fontSizeBase200,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: tokens.fontWeightSemibold,
    userSelect: 'none' as const,
    display: 'flex',
    alignItems: 'center',
  },
  separator: {
    width: '1px',
    height: '14px',
    backgroundColor: '#cfcfcc',
    flexShrink: 0,
    alignSelf: 'center',
  },
  archiveBtn: {
    padding: `0 10px`,
    height: '26px',
    borderRadius: '999px',
    border: `1px solid #cfcfcc`,
    backgroundColor: 'transparent',
    color: '#707070',
    fontSize: '11px',
    fontWeight: '500' as const,
    cursor: 'pointer',
    fontFamily: 'inherit',
    userSelect: 'none' as const,
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground2,
      color: '#424241',
    },
  },
  dropdownWrapper: {
    position: 'relative' as const,
    flexShrink: 0,
  },
  dropdown: {
    position: 'absolute' as const,
    top: '30px',
    left: 0,
    zIndex: 200,
    background: '#ffffff',
    border: `1px solid #d2d0ce`,
    borderRadius: 6,
    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
    minWidth: 190,
    maxHeight: 300,
    overflowY: 'auto' as const,
    padding: '4px 0',
  },
  dropdownItem: {
    height: '32px',
    padding: '0 14px',
    fontSize: '13px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: 'pointer',
    color: '#424241',
    userSelect: 'none' as const,
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground2,
    },
  },
});

interface Props {
  periods: Period[];
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
  allPeriods?: Period[];
  allowArchive?: boolean;
}

export const PeriodPillSelector: React.FC<Props> = ({
  periods,
  selectedIds,
  onChange,
  allPeriods,
  allowArchive = false,
}) => {
  const styles = useStyles();
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartIdx, setDragStartIdx] = useState<number | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseUp = () => { setIsDragging(false); setDragStartIdx(null); };
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, []);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  // Locked periods sorted newest-first for the dropdown
  const lockedPeriods = useMemo(() => {
    if (!allowArchive || !allPeriods) return [];
    return [...allPeriods]
      .filter(p => p.status !== 'open')
      .sort((a, b) => a.year !== b.year ? b.year - a.year : b.month - a.month);
  }, [allPeriods, allowArchive]);

  // Derive active locked period from selectedIds (at most one)
  const activeLocked = useMemo(
    () => lockedPeriods.find(p => selectedIds.has(p.id)) ?? null,
    [lockedPeriods, selectedIds]
  );

  const selectLocked = (p: Period) => {
    onChange(new Set([p.id]));
    setDropdownOpen(false);
  };

  return (
    <div
      className={styles.periodPills}
      style={{ cursor: isDragging ? 'grabbing' : 'default' }}
    >
      {/* Archive dropdown button — only shown when allowArchive and there are locked periods */}
      {allowArchive && lockedPeriods.length > 0 && (
        <div className={styles.dropdownWrapper} ref={dropdownRef}>
          <button
            className={styles.archiveBtn}
            onClick={() => setDropdownOpen(v => !v)}
          >
            <span>📅</span>
            <span>Archive</span>
            <span style={{ fontSize: 9, marginLeft: 1 }}>▼</span>
          </button>
          {dropdownOpen && (
            <div className={styles.dropdown}>
              {lockedPeriods.map(p => (
                <div
                  key={p.id}
                  className={styles.dropdownItem}
                  onMouseDown={e => { e.preventDefault(); selectLocked(p); }}
                >
                  <span>{fmtPeriodLong(p)}</span>
                  <LockIcon size={11} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Active locked period pill */}
      {activeLocked && (
        <>
          <button
            className={selectedIds.has(activeLocked.id) ? styles.periodPillLockedActive : styles.periodPillLocked}
            onMouseDown={e => {
              e.preventDefault();
              onChange(new Set([activeLocked.id]));
            }}
          >
            {fmtPeriodShort(activeLocked)}
            <LockIcon />
          </button>
          <div className={styles.separator} />
        </>
      )}

      {/* Open period pills */}
      {periods.map((p, i) => {
        const isSelected = selectedIds.has(p.id);
        const pillClass = isSelected
          ? (isDragging ? styles.periodPillInRange : styles.periodPillActive)
          : styles.periodPill;

        return (
          <button
            key={p.id}
            className={pillClass}
            onMouseDown={e => {
              e.preventDefault();
              setIsDragging(true);
              setDragStartIdx(i);
              // Selecting an open period clears any locked selection
              onChange(new Set([p.id]));
            }}
            onMouseEnter={() => {
              if (!isDragging || dragStartIdx === null) return;
              const lo = Math.min(dragStartIdx, i);
              const hi = Math.max(dragStartIdx, i);
              onChange(new Set(periods.slice(lo, hi + 1).map(x => x.id)));
            }}
          >
            {fmtPeriodShort(p)}
          </button>
        );
      })}
    </div>
  );
};
