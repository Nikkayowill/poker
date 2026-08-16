"use client";

import Link from "next/link";
import { tapSound } from "@/lib/audio/ui-sounds";

/**
 * The lobby's footer: quiet, always-there wayfinding to the pages that make
 * StackChips read as a real platform rather than a single-purpose app --
 * How to Play, Rewards, Help, About and the legal index.
 *
 * Lobby-only, mounted once at the bottom of the hub column rather than the
 * player menu (components/nav/menu.tsx). The menu is a verb list -- account
 * actions opened on demand -- and this is a trust surface that should be
 * visible without opening anything; it also has no reason to follow the
 * player to the table mid-hand. Before this existed, the five /legal/*
 * pages had no link pointing at them from anywhere in the app.
 */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <nav className="site-footer-links" aria-label="More about StackChips">
        <Link href="/how-to-play" onClick={tapSound}>How to Play</Link>
        <Link href="/rewards" onClick={tapSound}>Rewards</Link>
        <Link href="/help" onClick={tapSound}>Help</Link>
        <Link href="/about" onClick={tapSound}>About</Link>
        <Link href="/legal" onClick={tapSound}>Legal</Link>
      </nav>
      <p className="site-footer-meta">
        © {new Date().getFullYear()} StackChips · Gold is an in-app currency with no cash value.
      </p>
    </footer>
  );
}
