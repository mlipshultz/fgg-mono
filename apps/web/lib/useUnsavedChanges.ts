'use client';

import { useEffect } from 'react';

const MESSAGE = 'You have unsaved changes. Leave without saving?';

/**
 * While `dirty`, warn before the page is unloaded (browser prompt) and before any in-app link
 * navigation (our own confirm, since the App Router has no route-change event to cancel).
 */
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = MESSAGE; // legacy browsers need a value to show the prompt
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = (e.target as Element | null)?.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href') ?? '';
      if (href.startsWith('#') || a.getAttribute('target') === '_blank') return;
      if (!window.confirm(MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);
}

export const UNSAVED_MESSAGE = MESSAGE;
