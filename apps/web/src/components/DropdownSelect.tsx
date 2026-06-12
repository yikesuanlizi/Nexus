import React, { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon.js';

export interface DropdownOption<T extends string = string> {
  detail?: string;
  group?: string;
  label: string;
  value: T;
}

export function DropdownSelect<T extends string>({
  ariaLabel,
  className = '',
  options,
  title,
  value,
  onChange,
}: {
  ariaLabel?: string;
  className?: string;
  options: Array<DropdownOption<T>>;
  title?: string;
  value: T;
  onChange(value: T): void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div className={['dropdownSelect', className].filter(Boolean).join(' ')} ref={ref}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="dropdownButton"
        onClick={() => setOpen((value) => !value)}
        title={title}
        type="button"
      >
        <span>{selected?.label ?? value}</span>
        <Icon name="chevronDown" />
      </button>
      {open ? (
        <div className="dropdownMenu" id={id} role="listbox">
          {options.map((option, index) => {
            const previous = options[index - 1];
            const showGroup = option.group && option.group !== previous?.group;
            return (
              <React.Fragment key={`${option.group ?? 'group'}-${option.value}`}>
                {showGroup ? <div className="dropdownGroup">{option.group}</div> : null}
                <button
                  aria-selected={option.value === value}
                  className={option.value === value ? 'dropdownOption active' : 'dropdownOption'}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  role="option"
                  type="button"
                >
                  <span>{option.label}</span>
                  {option.detail ? <small>{option.detail}</small> : null}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
