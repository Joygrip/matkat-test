import React, { useState, useEffect } from 'react';
import { makeStyles, tokens } from '@fluentui/react-components';
import { Period } from '../../types/index';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtPeriodShort = (p: Period) => `${MONTH_ABBR[p.month - 1]} '${String(p.year).slice(2)}`;

const useStyles = makeStyles({
  periodPills: {
    display: 'flex',
    gap: tokens.spacingHorizontalXS,
    flexWrap: 'wrap' as const,
    alignItems: 'center',
  },
  periodPill: {
    padding: `4px 10px`,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    cursor: 'pointer',
    fontFamily: 'inherit',
    userSelect: 'none' as const,
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground3,
    },
  },
  periodPillActive: {
    padding: `4px 10px`,
    borderRadius: tokens.borderRadiusMedium,
    border: '1px solid #1e3a5f',
    backgroundColor: '#1e3a5f',
    color: '#ffffff',
    fontSize: tokens.fontSizeBase200,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: tokens.fontWeightSemibold,
    userSelect: 'none' as const,
  },
  periodPillInRange: {
    padding: `4px 10px`,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid #4a90d9`,
    backgroundColor: '#d0e3f7',
    color: '#1e3a5f',
    fontSize: tokens.fontSizeBase200,
    cursor: 'grabbing',
    fontFamily: 'inherit',
    fontWeight: tokens.fontWeightSemibold,
    userSelect: 'none' as const,
  },
});

interface Props {
  periods: Period[];
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
}

export const PeriodPillSelector: React.FC<Props> = ({ periods, selectedIds, onChange }) => {
  const styles = useStyles();
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartIdx, setDragStartIdx] = useState<number | null>(null);

  useEffect(() => {
    const handleMouseUp = () => { setIsDragging(false); setDragStartIdx(null); };
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, []);

  return (
    <div
      className={styles.periodPills}
      style={{ cursor: isDragging ? 'grabbing' : 'default' }}
    >
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
