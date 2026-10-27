import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { DownloadIcon, SpinnerIcon } from './icons';

export type DownloadFormat = 'png' | 'jpeg' | 'svg' | 'csv' | 'xlsx' | 'pdf';

export const FORMAT_LABELS: Record<DownloadFormat, string> = {
  png: 'PNG image',
  jpeg: 'JPEG image',
  svg: 'SVG vector',
  csv: 'CSV data',
  xlsx: 'Excel workbook',
  pdf: 'PDF document',
};

export interface DownloadMenuProps<F extends DownloadFormat> {
  formats: F[];
  onSelect: (format: F) => Promise<void> | void;
  label?: string;
  disabled?: boolean;
  /** Show a text label next to the icon. */
  showLabel?: boolean;
}

/** Accessible menu button: Enter/Space/↓ opens, arrows move, Esc closes, focus returns to the button. */
export function DownloadMenu<F extends DownloadFormat>({ formats, onSelect, label = 'Download', disabled, showLabel }: DownloadMenuProps<F>) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<F | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    first?.focus();
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const close = (focusButton = true) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };

  const choose = async (format: F) => {
    close();
    setBusy(format);
    try {
      await onSelect(format);
    } finally {
      setBusy(null);
    }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  if (formats.length === 0) return null;

  return (
    <div className="rd-menu">
      <button
        ref={buttonRef}
        type="button"
        className={showLabel ? 'rd-button' : 'rd-icon-button'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={showLabel ? undefined : busy ? `Preparing ${FORMAT_LABELS[busy]}` : label}
        title={showLabel ? undefined : label}
        disabled={disabled || busy !== null}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {busy ? <SpinnerIcon size={16} /> : <DownloadIcon size={16} />}
        {showLabel ? <span>{busy ? 'Preparing…' : label}</span> : null}
      </button>
      {open ? (
        <div ref={menuRef} id={id} role="menu" aria-label={label} className="rd-menu__list" onKeyDown={onMenuKey}>
          {formats.map((format) => (
            <button key={format} type="button" role="menuitem" tabIndex={-1} className="rd-menu__item" onClick={() => void choose(format)}>
              <span>{FORMAT_LABELS[format]}</span>
              <span className="rd-menu__ext">.{format === 'jpeg' ? 'jpg' : format}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
