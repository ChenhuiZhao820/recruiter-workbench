"use client";

import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";

// A page shown as a popup over the one it was opened from (an intercepted
// route). Closing it, by the cross, Esc or the blurred backdrop, goes back.
// A plain GET form inside it (a search, say) is sent through the router, so
// the popup stays up instead of the browser loading the page full screen.
export function Overlay({ label, children }: { label: string; children: ReactNode }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  // Only the person closing it sends the browser back; the dialog closing as
  // the page goes away (or as React remounts it in development) must not.
  const asked = useRef(false);
  // Searches made inside the popup are history entries of their own; closing
  // goes back past all of them, to the page the popup was opened from.
  const pushes = useRef(0);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      element?.close();
    };
  }, []);

  function close() {
    asked.current = true;
    dialog.current?.close();
  }

  function submit(event: FormEvent<HTMLElement>) {
    const form = event.target as HTMLFormElement;
    if (form.tagName !== "FORM" || form.getAttribute("method")?.toLowerCase() !== "get") return;
    event.preventDefault();
    const params = new URLSearchParams();
    new FormData(form).forEach((value, key) => { if (typeof value === "string") params.append(key, value); });
    const path = window.location.pathname;
    pushes.current += 1;
    router.push(params.size ? `${path}?${params.toString()}` : path, { scroll: false });
  }

  return (
    <dialog
      ref={dialog}
      className="overlay-dialog"
      aria-label={label}
      onCancel={() => { asked.current = true; }}
      onClose={() => { if (!asked.current) return; if (pushes.current > 0) window.history.go(-(pushes.current + 1)); else router.back(); }}
      onMouseDown={(event) => { if (event.target === dialog.current) close(); }}
    >
      <button type="button" className="overlay-close hover-tip" aria-label={`Close ${label}`} data-tip="Close" onClick={close}>
        <Icon name="close" size={18} />
      </button>
      <div className="overlay-body" onSubmit={submit}>{children}</div>
    </dialog>
  );
}
