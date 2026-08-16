"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Coins } from "lucide-react";
import type { PlayerProfile } from "@/lib/profile/types";
import { dailyGoldState } from "@/lib/profile/daily-gold";
import { backstopState, BACKSTOP_GRANT } from "@/lib/profile/backstop";
import { streakMultiplier, STREAK_CAP_DAYS } from "@/lib/progression/streak";
import { REWARDED_AD_GOLD, REWARDED_AD_DAILY_LIMIT, REWARDED_AD_DURATION_LABEL } from "@/lib/rewards/config";
import { CHEAPEST_TIER, TIER_CONFIG } from "@/lib/game/tiers";
import { tapSound } from "@/lib/audio/ui-sounds";

/**
 * "Ways to earn Gold", on one page -- the PlayPokerGO-style promotions/VIP
 * tab StackChips didn't have. Every source it lists (missions, the daily
 * grant, rewarded ads, the recovery top-up, buying Gold) already exists and
 * is claimed elsewhere -- the lobby's player menu, the lobby's own banner,
 * /challenges, /store/gold. This page is wayfinding and honest state, not a
 * second claim surface: duplicating claimDailyGold/rewarded-ad-service's
 * money-moving calls here would be a second place for the money-ordering
 * rules in CLAUDE.md to be gotten right, for no reader benefit over "open
 * the lobby."
 *
 * Achievements/badges are deliberately listed as not-yet-open rather than
 * left off the page -- `profile_badges` and four cosmetic catalog entries
 * already have achievement-shaped descriptions with nothing granting them
 * yet (CLAUDE.md, "economy/retention redesign"). Naming the gap is the same
 * call components/nav/menu.tsx makes for a claimed daily grant: a state is
 * worth saying, not hiding.
 *
 * Fetches its own profile, same reasoning and same deferred-timer shape as
 * components/arcade/arcade-floor.tsx: this route doesn't mount PokerApp, so
 * there is no profile in scope to receive as a prop.
 */
export function RewardsHub() {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/profile", { cache: "no-store" });
        if (!mounted.current) return;
        if (response.ok) setProfile(((await response.json()) as { profile: PlayerProfile }).profile);
      } catch {
        // An unreachable profile just leaves every card in its unloaded
        // state -- the page still explains every source.
      } finally {
        if (mounted.current) setLoaded(true);
      }
    }, 0);
    return () => {
      mounted.current = false;
      window.clearTimeout(timer);
    };
  }, []);

  const now = new Date();
  const daily = dailyGoldState(profile, now);
  const backstop = backstopState(profile, now, TIER_CONFIG[CHEAPEST_TIER].minBuyIn);
  const maxMultiplier = streakMultiplier(STREAK_CAP_DAYS);

  return (
    <main className="floor-shell">
      <header className="floor-bar">
        <Link className="floor-back" href="/" onClick={tapSound}>← The floor</Link>
        <span className="gold-balance floor-wallet">
          <Coins size={13} aria-hidden="true" />
          <strong>
            {!loaded || !profile
              ? "—"
              : profile.unlimitedGold ? "Unlimited" : profile.goldBalance.toLocaleString()}
          </strong>
        </span>
      </header>

      <div className="floor-head">
        <div className="lobby-kicker">Rewards</div>
        <h1>Every way into Gold.</h1>
        <p>Nothing here is required to play — buying Gold is one option among several.</p>
      </div>

      <section className="floor-section" aria-labelledby="rewards-earn">
        <h2 className="floor-section-head" id="rewards-earn">Earn it</h2>
        <div className="floor-free-grid">
          <article className="floor-card">
            <strong>Daily &amp; weekly missions</strong>
            <small>Objectives credit Gold the moment they&rsquo;re complete — nothing to claim.</small>
            <Link className="floor-play" href="/challenges" onClick={tapSound}>Open Challenges</Link>
          </article>

          <article className="floor-card">
            <strong>Daily Gold</strong>
            <small>
              Comes back bigger the more days in a row you claim it — up to{" "}
              {maxMultiplier}× at a {STREAK_CAP_DAYS}-day streak. Break the streak and it resets.
            </small>
            <small className="floor-card-stake">{rewardStatusLabel(daily)}</small>
            <Link className="floor-play" href="/" onClick={tapSound}>Open the lobby</Link>
          </article>

          <article className="floor-card">
            <strong>Watch &amp; earn</strong>
            <small>
              A {REWARDED_AD_DURATION_LABEL} rewarded ad from the lobby&rsquo;s player menu pays{" "}
              {REWARDED_AD_GOLD.toLocaleString()} Gold, up to {REWARDED_AD_DAILY_LIMIT} times a day.
            </small>
            <Link className="floor-play" href="/" onClick={tapSound}>Open the lobby</Link>
          </article>

          <article className="floor-card">
            <strong>Recovery top-up</strong>
            <small>
              Drop below the cheapest table&rsquo;s buy-in and the lobby offers a one-time{" "}
              {BACKSTOP_GRANT.toLocaleString()}-Gold top-up — never far off, never a farmable income.
            </small>
            <small className="floor-card-stake">{backstopStatusLabel(backstop)}</small>
          </article>
        </div>
      </section>

      <section className="floor-section" aria-labelledby="rewards-buy">
        <h2 className="floor-section-head" id="rewards-buy">Buy it</h2>
        <div className="floor-free-grid">
          <article className="floor-card">
            <strong>Buy Gold</strong>
            <small>Optional, and never required to play a single hand.</small>
            <Link className="floor-play" href="/store/gold" onClick={tapSound}>Open the store</Link>
          </article>

          <article className="floor-card">
            <strong>Support StackChips</strong>
            <small>A voluntary gift toward running costs — grants no Gold and no gameplay edge.</small>
            <Link className="floor-play" href="/store" onClick={tapSound}>Open Support</Link>
          </article>
        </div>
      </section>

      <section className="floor-section" aria-labelledby="rewards-coming">
        <h2 className="floor-section-head" id="rewards-coming">Coming</h2>
        <div className="floor-free-grid">
          <article className="floor-card">
            <strong>Achievements &amp; badges</strong>
            <small>Not open yet — the next stop on StackChips&rsquo; progression roadmap.</small>
            <button type="button" className="floor-play" disabled>Coming soon</button>
          </article>
        </div>
      </section>
    </main>
  );
}

function rewardStatusLabel(state: ReturnType<typeof dailyGoldState>): string {
  switch (state) {
    case "ready": return "Ready to claim today";
    case "claimed": return "Claimed today";
    case "guest": return "Sign in to claim";
    case "unlimited": return "Not needed — unlimited Gold";
    default: return "—";
  }
}

function backstopStatusLabel(state: ReturnType<typeof backstopState>): string {
  switch (state) {
    case "ready": return "Available now";
    case "cooldown": return "Already claimed recently";
    case "not-needed": return "Not needed — balance is healthy";
    case "unlimited": return "Not needed — unlimited Gold";
    default: return "—";
  }
}
