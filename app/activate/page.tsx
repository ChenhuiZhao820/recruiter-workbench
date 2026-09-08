import { ActivationForm } from "@/components/AccountForms";

export const dynamic = "force-dynamic";

export default function ActivatePage() {
  return <div className="mx-auto max-w-md space-y-4">
    <h1 className="text-3xl">Set your password</h1>
    <p className="text-ink-soft">This one-time link activates your account or resets your password.</p>
    <ActivationForm />
  </div>;
}
