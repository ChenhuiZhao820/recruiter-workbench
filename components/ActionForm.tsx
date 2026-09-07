"use client";

import { useFormState } from "react-dom";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/formState";

// A form whose server action can talk back. Any action that validates its
// input returns a FormState, and whatever it says is shown above the fields.
export function ActionForm({
  action,
  children,
  className,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction] = useFormState(action, EMPTY_FORM_STATE);

  return (
    <form action={formAction} className={className}>
      {state.error && (
        <p
          role="alert"
          data-form-message="error"
          className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900"
        >
          {state.error}
        </p>
      )}
      {state.notice && (
        <p
          role="status"
          data-form-message="notice"
          className="rounded border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-ink"
        >
          {state.notice}
        </p>
      )}
      {children}
    </form>
  );
}
