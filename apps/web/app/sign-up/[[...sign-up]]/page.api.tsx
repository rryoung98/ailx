/**
 * The twin of `/sign-in`, and not optional: Clerk's sign-in card links to
 * `signUpUrl`, so without this route the first click of a new candidate is a
 * 404. Hosted-only for the same reason, by the same naming convention.
 */
import { SignUp } from "@clerk/nextjs";

export const metadata = { title: "Create an account — AILX" };

export default function SignUpPage() {
  return (
    <main className="container" style={{ display: "grid", justifyContent: "center", padding: "3rem 0" }}>
      <SignUp path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/" />
    </main>
  );
}
