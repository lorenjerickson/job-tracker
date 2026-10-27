"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Board" },
  { href: "/resume", label: "My Resume" },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      <Link href="/" className="brand">
        <span className="brand-dot" /> Job Tracker
      </Link>
      <div className="nav-links">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={(l.href === "/" ? path === "/" : path.startsWith(l.href)) ? "active" : ""}>
            {l.label}
          </Link>
        ))}
      </div>
      <div className="nav-spacer" />
      <Link href="/applications/new" className="btn primary sm">
        + New application
      </Link>
    </nav>
  );
}
