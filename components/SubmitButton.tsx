"use client";

import { useFormStatus } from "react-dom";

// A submit button that says what is happening while its form is in flight,
// and cannot be pressed twice meanwhile.
export function SubmitButton({
  children,
  pendingLabel,
  className = "btn-primary",
  disabled = false,
  name,
  value,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
  disabled?: boolean;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={disabled || pending} aria-disabled={disabled || pending} name={name} value={value}>
      {pending ? pendingLabel : children}
    </button>
  );
}
