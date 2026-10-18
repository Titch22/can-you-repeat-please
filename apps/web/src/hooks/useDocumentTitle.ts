import { useEffect } from 'react';

const BASE = 'Can You Repeat Please?';

/** Sets the tab title (e.g. "ABCD · Round 2/5"), so a friend's room is easy to find in tabs. */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · ${BASE}` : BASE;
    return () => {
      document.title = BASE;
    };
  }, [title]);
}
