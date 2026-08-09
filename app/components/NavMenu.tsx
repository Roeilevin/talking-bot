"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./nav.module.css";

const LINKS = [
  { href: "/dashboard", label: "History" },
  { href: "/allowed-numbers", label: "Allowed numbers" },
  { href: "/users", label: "Users" },
];

// Shared top bar for the signed-in pages. Collapses to a hamburger under 640px.
export default function NavMenu({ email }: { email?: string | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <nav className={styles.nav}>
      <div className={styles.bar}>
        <Link href="/dashboard" className={styles.brand}>
          Bein Harim <span className={styles.brandThin}>Talking Bot</span>
        </Link>

        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls="nav-menu"
          onClick={() => setOpen((v) => !v)}
        >
          <span className={styles.srOnly}>Menu</span>
          <span aria-hidden="true">{open ? "✕" : "☰"}</span>
        </button>

        <div
          id="nav-menu"
          className={`${styles.items} ${open ? styles.itemsOpen : ""}`}
        >
          <ul className={styles.links}>
            {LINKS.map((link) => {
              const active = pathname === link.href;
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={`${styles.link} ${active ? styles.active : ""}`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className={styles.account}>
            {email ? (
              <span className={styles.email} title={email}>
                {email}
              </span>
            ) : null}
            <form method="POST" action="/api/logout">
              <button type="submit" className={styles.signOut}>
                Sign out
              </button>
            </form>
          </div>
        </div>
      </div>
    </nav>
  );
}
