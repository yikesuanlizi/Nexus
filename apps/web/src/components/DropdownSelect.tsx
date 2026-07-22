// 通用下拉选择组件：支持分组、标题/详细描述、点击外部关闭
// Generic dropdown select: supports grouping, label/detail, click-outside close

import React, { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon.js';

export interface DropdownOption<T extends string = string> {
  action?: {
    ariaLabel: string;
    className?: string;
    disabled?: boolean;
    label: string;
    onClick: () => Promise<void> | void;
  };
  current?: boolean;
  detail?: string;
  group?: string;
  label: string;
  title?: string;
  value: T;
}
// 单个下拉选项：value 为值，label 为显示文本，detail 是辅助描述，group 用于分组，current 标记"当前配置"
// Single dropdown option: value is the value, label is display text, detail is auxiliary description, group for grouping, current marks "current config"

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

  function selectOption(option: DropdownOption<T>) {
    onChange(option.value);
    setOpen(false);
  }

  // 点击组件外部时关闭下拉（避免事件冒泡被截获导致无法关闭）
  // Closes the dropdown on click outside (prevents event capture from blocking close)
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
                <div className={option.action ? 'dropdownOptionRow' : ''}>
                  <button
                    aria-selected={option.value === value}
                    className={['dropdownOption', option.value === value ? 'active' : '', option.current ? 'current' : ''].filter(Boolean).join(' ')}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectOption(option);
                    }}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    role="option"
                    title={option.title}
                    type="button"
                  >
                    <span>{option.label}</span>
                    {option.detail ? <small>{option.detail}</small> : null}
                  </button>
                  {option.action ? (
                    <button
                      aria-label={option.action.ariaLabel}
                      className={['dropdownOptionAction', option.action.className ?? ''].filter(Boolean).join(' ')}
                      disabled={option.action.disabled}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setOpen(false);
                        void option.action?.onClick();
                      }}
                      type="button"
                    >
                      {option.action.label}
                    </button>
                  ) : null}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
