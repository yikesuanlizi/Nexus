import React from 'react';
import { Icon } from './Icon.js';

export function TitleBar({ title }: { title: string }) {
  return (
    <header className="titleBar" data-testid="titleBar">
      <span className="titleBarIdentity"><Icon name="layers" /><span className="titleBarTitle">{title}</span></span>
    </header>
  );
}
