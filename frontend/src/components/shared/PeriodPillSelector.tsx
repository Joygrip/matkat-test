import React, { useState, useEffect, useMemo } from 'react';
import { makeStyles, tokens } from '@fluentui/react-components';
import { Period } from '../../types/index';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtPeriodShort = (p: Period) => `${MONTH_ABBR[p.month - 1]} '${String(p.year).slice(2)}`;

const LockIcon = () => (
  <svg
    width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
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
  periodPillLockedInRange: {
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
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground2,
      color: '#424241',
    },
  },
  hideArchiveBtn: {
    padding: `0 8px`,
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
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground2,
      color: '#424241',
    },
  },
  separator: {
    width: '1px',
    height: '14px',
    backgroundColor: '#cfcfcc',
    flexShrink: 0,
    alignSelf: 'center',
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
  const [archiveCount, setArchiveCount] = useState(0);

  useEffect(() => {
    const handleMouseUp = () => { setIsDragging(false); setDragStartIdx(null); };
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, []);

  // Locked periods sorted ascending so newest are at the tail (slice(-N) gives newest N)
  const lockedPeriods = useMemo(() => {
    if (!allowArchive || !allPeriods) return [];
    return [...allPeriods]
      .filter(p => p.status !== 'open')
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
  }, [allPeriods, allowArchive]);

  const remaining = lockedPeriods.length - archiveCount;
  const visibleLocked = archiveCount > 0 ? lockedPeriods.slice(-Math.min(archiveCount, lockedPeriods.length)) : [];
  const allVisible = [...visibleLocked, ...periods];
  const lockedIdSet = useMemo(() => new Set(lockedPeriods.map(p => p.id)), [lockedPeriods]);

  const showArchiveBtn = allowArchive && remaining > 0;
  const showHideBtn = allowArchive && archiveCount > 0;

  const hideArchive = () => {
    setArchiveCount(0);
    const filtered = new Set([...selectedIds].filter(id => !lockedIdSet.has(id)));
    if (filtered.size !== selectedIds.size) onChange(filtered);
  };

  return (
    <div
      className={styles.periodPills}
      style={{ cursor: isDragging ? 'grabbing' : 'default' }}
    >
      {showHideBtn && (
        <button className={styles.hideArchiveBtn} onClick={hideArchive}>
          ✕
        </button>
      )}
      {showArchiveBtn && (
        <button
          className={styles.archiveBtn}
          onClick={() => setArchiveCount(prev => prev + 3)}
        >
          ← +{Math.min(3, remaining)}
        </button>
      )}
      {allVisible.map((p, i) => {
        const isLocked = lockedIdSet.has(p.id);
        const isSelected = selectedIds.has(p.id);

        let pillClass: string;
        if (isLocked) {
          pillClass = isSelected
            ? (isDragging ? styles.periodPillLockedInRange : styles.periodPillLockedActive)
            : styles.periodPillLocked;
        } else {
          pillClass = isSelected
            ? (isDragging ? styles.periodPillInRange : styles.periodPillActive)
            : styles.periodPill;
        }

        // Show separator between last locked pill and first open pill
        const nextIsOpen = i < allVisible.length - 1 && !lockedIdSet.has(allVisible[i + 1].id);
        const showSeparator = isLocked && nextIsOpen;

        return (
          <React.Fragment key={p.id}>
            <button
              className={pillClass}
              onMouseDown={e => {
                e.preventDefault();
                setIsDragging(true);
                setDragStartIdx(i);
                onChange(new Set([p.id]));
              }}
              onMouseEnter={() => {
                if (!isDragging || dragStartIdx === null) return;
                const lo = Math.min(dragStartIdx, i);
                const hi = Math.max(dragStartIdx, i);
                onChange(new Set(allVisible.slice(lo, hi + 1).map(x => x.id)));
              }}
            >
              {fmtPeriodShort(p)}
              {isLocked && <LockIcon />}
            </button>
            {showSeparator && <div className={styles.separator} />}
          </React.Fragment>
        );
      })}
    </div>
  );
};
