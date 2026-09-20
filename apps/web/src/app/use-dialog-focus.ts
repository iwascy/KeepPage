import { useEffect, useRef } from "react";

/** Trap modal keyboard focus and restore its opener without re-focusing on edits. */
export function useDialogFocus<T extends HTMLElement = HTMLDivElement>(open: boolean, onClose: () => void, busy = false) {
  const dialogRef = useRef<T | null>(null);
  const controls = useRef({ onClose, busy });
  controls.current = { onClose, busy };
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const getFocusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter((node) => node.getClientRects().length > 0);
    const frame = requestAnimationFrame(() => {
      if (!dialog.contains(document.activeElement)) (getFocusable()[0] ?? dialog).focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!controls.current.busy) controls.current.onClose();
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    const keepFocus = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) (getFocusable()[0] ?? dialog).focus();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", keepFocus);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", keepFocus);
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);
  return dialogRef;
}
