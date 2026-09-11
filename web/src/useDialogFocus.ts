import { useEffect, useRef } from 'preact/hooks';

/** Keep keyboard navigation in a modal and return focus to its opener. */
export function useDialogFocus() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    )).filter((element) => element.getClientRects().length > 0);
    const focusFirst = () => (controls()[0] ?? dialog).focus();
    focusFirst();
    const contain = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) focusFirst();
    };
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = controls();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('focusin', contain);
    dialog.addEventListener('keydown', trap);
    return () => {
      document.removeEventListener('focusin', contain);
      dialog.removeEventListener('keydown', trap);
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return ref;
}
