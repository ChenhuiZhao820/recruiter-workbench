import { requireUser } from "@/lib/auth";
import { PasswordForm } from "@/components/AccountForms";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser();
  return <div className="max-w-xl space-y-4">
    <h1 className="text-3xl">Your account</h1>
    <p>{user.name} · {user.email}</p>
    <h2 className="text-lg">Change password</h2>
    <PasswordForm />
  </div>;
}
