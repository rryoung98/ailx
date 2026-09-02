"use client";

/**
 * Nav link with an active-state indicator: marks the current page with
 * aria-current="page" (styled green in CSS). Client-only because it reads
 * the pathname; the surrounding <nav> stays in the server layout.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

const norm = (p: string) => (p.replace(/\/+$/, "") || "/");

export function NavLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const current = pathname != null && norm(pathname) === norm(href);
  return (
    <Link href={href} className={className} aria-current={current ? "page" : undefined}>
      {children}
    </Link>
  );
}
