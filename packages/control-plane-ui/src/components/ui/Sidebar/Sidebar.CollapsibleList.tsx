import { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';
import styles from './Sidebar.module.css';

/* ── Collapsible list (animated max-height) ───────────────────────────────── */

export function CollapsibleList({ open, children }: { open: boolean; children: React.ReactNode }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<string>(open ? 'none' : '0px');

  useEffect(() => {
    if (open) {
      const h = innerRef.current?.scrollHeight ?? 0;
      setMaxHeight(`${h}px`);
      const timer = setTimeout(() => setMaxHeight('none'), 220);
      return () => clearTimeout(timer);
    }
    if (innerRef.current) {
      setMaxHeight(`${innerRef.current.scrollHeight}px`);

      innerRef.current.offsetHeight;
    }
    requestAnimationFrame(() => setMaxHeight('0px'));
  }, [open]);

  return (
    <div
      ref={innerRef}
      className={clsx(styles.collapsibleWrapper, maxHeight === 'none' && styles.collapsibleNone)}
      style={{ maxHeight }}
    >
      {children}
    </div>
  );
}
