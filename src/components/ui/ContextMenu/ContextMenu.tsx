import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import styles from './ContextMenu.module.css';

export interface ContextMenuItem {
  key: string;
  label: string;
  hint?: string;
  onSelect: () => void;
}

interface ContextMenuProps {
  // Viewport position of the click.
  x: number;
  y: number;
  title?: string;
  items: ContextMenuItem[];
  onClose: () => void;
  onHover?: (key: string | null) => void;
}

// Floating menu at a point; closes on outside press, Escape or scroll.
export function ContextMenu({ x, y, title, items, onClose, onHover }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Keep inside the viewport.
  useLayoutEffect(() => {
    const el = ref.current!;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.max(0, Math.min(x, window.innerWidth - width)),
      y: Math.max(0, Math.min(y, window.innerHeight - height)),
    });
  }, [x, y]);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onWheel = (e: WheelEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey);
    document.addEventListener('wheel', onWheel, true);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={styles.menu}
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {title && <div className={styles.title}>{title}</div>}
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className={styles.item}
          onPointerEnter={() => onHover?.(item.key)}
          onPointerLeave={() => onHover?.(null)}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
        >
          <span className={styles.label}>{item.label}</span>
          {item.hint && <span className={styles.hint}>{item.hint}</span>}
        </button>
      ))}
    </div>
  );
}
