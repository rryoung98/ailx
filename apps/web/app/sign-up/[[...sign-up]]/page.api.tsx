/**
 * The twin of `/sign-in`, and not optional: Clerk's sign-in card links to
 * `signUpUrl`, so without this route the first click of a new candidate is a
 * 404. Hosted-only for the same reason, by the same naming convention, and
 * gated on the publishable key for the same reason as its twin (TEN-155): a
 * hosted build with no key mounts no provider, and `<SignUp>` would throw.
 */
import { notFound } from "next/navigation";
import { SignUp } from "@clerk/nextjs";
import { isClerkEnabled } from "../../../lib/mode";

export const metadata = { title: "Create an account — Foray" };

export default function SignUpPage() {
  if (!isClerkEnabled()) notFound();
  return (
    <main className="container" style={{ display: "grid", justifyContent: "center", padding: "3rem 0" }}>
      <SignUp path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/" />
    </main>
  );
}
