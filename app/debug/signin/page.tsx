/**
 * Isolated sign-in screen for phone testing, with a live layout adjuster.
 *
 * Mounts the real EntryHero + AccountEntryCard against the real
 * app/globals.css chain (this route sits under the same root layout as
 * everything else) with no game/session/network wiring behind it -- just
 * enough local state to flip through the screen's own states. The wrapper
 * markup (.app-root > .app-entry-sky, .account-entry-page) is reproduced
 * exactly because 02-app-shell.css's `.app-root:has(.account-entry-page) >
 * .app-entry-sky` selector depends on that exact shape.
 *
 * The "Adjust" drawer below is not a mockup -- it's a `!important` override
 * stylesheet (bottom of this file) that targets the SAME selectors
 * 04-lobby.css already uses, with `var(--dbg-*, <real production value>)`
 * as every property. Untouched, every fallback equals what's actually
 * shipping, so the page renders identically to production until a slider
 * is moved; moving one calls `document.documentElement.style.setProperty`,
 * which is real, immediate, on the real DOM -- not a redraw of a copy.
 * "Copy CSS" reads back whatever's currently been touched and prints it as
 * a real 04-lobby.css patch, selector and property named to match the
 * source file exactly (see SLIDERS' `selector`/`prop` below).
 *
 * Visit http://192.168.2.144:3000/debug/signin on your phone (same wifi as
 * the dev machine).
 */

'use client';

import { useState } from 'react';
import type { PlayerProfile } from '@/lib/profile/types';
import { AccountEntryCard } from '@/components/auth/account-entry-card';
import { EntryHero } from '@/components/auth/entry-hero';
import './signin-debug.css';

/** Just enough of a profile for the "signed in" preview state to render. */
const FAKE_PROFILE = { displayName: 'Kayo', isRegistered: true } as unknown as PlayerProfile;

type PreviewState = 'signed-out' | 'checking' | 'signed-in' | 'error' | 'no-accounts';

const STATES: { id: PreviewState; label: string }[] = [
  { id: 'signed-out', label: 'Signed out' },
  { id: 'checking', label: 'Checking session' },
  { id: 'signed-in', label: 'Signed in' },
  { id: 'error', label: 'Error message' },
  { id: 'no-accounts', label: 'Accounts unavailable' },
];

/**
 * One entry per real value this drawer can move. `var` is the custom
 * property set on <html>; `selector`/`prop` are the REAL 04-lobby.css
 * target the override stylesheet below re-declares `!important`, and are
 * printed verbatim into the "Copy CSS" output so a moved slider maps back
 * to an exact place to paste in the real file. `def` is the real current
 * value in 04-lobby.css -- the var()'s fallback, so an untouched slider
 * changes nothing.
 */
const SLIDERS: {
  group: string;
  key: string;
  label: string;
  selector: string;
  prop: string;
  min: number;
  max: number;
  def: number;
  unit: 'px' | '%';
}[] = [
  // .entry-hero itself -- the three-character lineup's box. Defaults below
  // are the app/styles/12-responsive.css @media(max-width:600px) values
  // (what an actual phone gets), not the wider base rule in 04-lobby.css --
  // the first version of this tool read only the base rule and showed
  // defaults (112/380/148/120/34/14...) that never matched what a phone
  // actually renders. Re-verify against a live `getComputedStyle` on a real
  // phone-width render before trusting a number here again.
  { group: 'Character lineup', key: '--dbg-hero-top', label: 'Vertical position', selector: '.entry-hero', prop: 'top', min: 0, max: 220, def: 40, unit: 'px' },
  { group: 'Character lineup', key: '--dbg-hero-width', label: 'Box width', selector: '.entry-hero', prop: 'width', min: 260, max: 420, def: 371, unit: 'px' },
  { group: 'Character lineup', key: '--dbg-hero-height', label: 'Box height', selector: '.entry-hero', prop: 'height', min: 140, max: 320, def: 230, unit: 'px' },
  { group: 'Character lineup', key: '--dbg-hero-center-width', label: 'Center character width', selector: '.entry-hero-center', prop: 'width', min: 25, max: 60, def: 40, unit: '%' },
  { group: 'Character lineup', key: '--dbg-hero-side-width', label: 'Side characters width', selector: '.entry-hero-side', prop: 'width', min: 20, max: 50, def: 34, unit: '%' },
  { group: 'Character lineup', key: '--dbg-hero-side-height', label: 'Side characters height', selector: '.entry-hero-side', prop: 'height', min: 50, max: 100, def: 82, unit: '%' },
  // .entry-logo -- the wordmark.
  { group: 'Logo', key: '--dbg-logo-width', label: 'Width', selector: '.entry-logo', prop: 'width', min: 200, max: 420, def: 340, unit: 'px' },
  { group: 'Logo', key: '--dbg-logo-margin', label: 'Bottom spacing', selector: '.entry-logo', prop: 'margin-bottom', min: 0, max: 40, def: 3, unit: 'px' },
  // The headline + description under the logo.
  { group: 'Headline text', key: '--dbg-title-size', label: 'Title size', selector: '.account-entry-card h1', prop: 'font-size', min: 18, max: 44, def: 25, unit: 'px' },
  { group: 'Headline text', key: '--dbg-desc-size', label: 'Description size', selector: '.account-entry-card > .entry-head > p:not(.account-entry-status)', prop: 'font-size', min: 10, max: 20, def: 13, unit: 'px' },
  // The Google / Email / guest button stack.
  { group: 'Buttons', key: '--dbg-actions-gap', label: 'Gap between buttons', selector: '.account-entry-actions', prop: 'gap', min: 0, max: 24, def: 9, unit: 'px' },
  { group: 'Buttons', key: '--dbg-actions-margin', label: 'Space above buttons', selector: '.account-entry-actions', prop: 'margin-top', min: 0, max: 40, def: 8, unit: 'px' },
  { group: 'Buttons', key: '--dbg-button-height', label: 'Button height', selector: '.account-primary-action, .account-oauth-action, .account-guest-action, .account-email-toggle', prop: 'min-height', min: 36, max: 64, def: 48, unit: 'px' },
  { group: 'Buttons', key: '--dbg-button-px', label: 'Button side padding', selector: '.account-primary-action, .account-oauth-action, .account-guest-action, .account-email-toggle', prop: 'padding-left/right', min: 8, max: 32, def: 12, unit: 'px' },
  { group: 'Buttons', key: '--dbg-button-text', label: 'Button text size', selector: '.account-primary-action, .account-oauth-action, .account-guest-action, .account-email-toggle', prop: 'font-size', min: 12, max: 20, def: 15, unit: 'px' },
  // The page's own top/bottom clearance -- pushes the whole form down/up.
  { group: 'Page frame', key: '--dbg-page-pad-top', label: 'Space above form', selector: '.account-entry-page', prop: 'padding-top (before --safe-top)', min: 60, max: 260, def: 198, unit: 'px' },
  { group: 'Page frame', key: '--dbg-page-pad-bottom', label: 'Space below form', selector: '.account-entry-page', prop: 'padding-bottom (before --safe-bottom)', min: 0, max: 220, def: 40, unit: 'px' },
  { group: 'Page frame', key: '--dbg-footer-pad', label: 'Legal-links bar padding', selector: '.entry-footer', prop: 'padding-top', min: 0, max: 32, def: 6, unit: 'px' },
];

export default function SignInDebugPage() {
  const [state, setState] = useState<PreviewState>('signed-out');
  const [remember, setRemember] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Only the vars a slider has actually touched -- everything else stays on
  // its real-CSS fallback, so "Copy CSS" only ever prints real changes.
  const [touched, setTouched] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState(false);
  // One group's sliders on screen at a time, in a short bottom sheet --
  // the first version stacked all 18 in a full-bleed panel pinned to the
  // TOP, which is exactly where the hero/logo/title live: every slider
  // that touched one of those was invisible while you dragged it. This
  // way the sheet stays a few sliders tall and the piece being adjusted
  // sits in the open space above it.
  const [activeGroup, setActiveGroup] = useState(SLIDERS[0].group);

  const setVar = (key: string, value: number, unit: 'px' | '%') => {
    document.documentElement.style.setProperty(key, `${value}${unit}`);
    setTouched((prev) => ({ ...prev, [key]: value }));
  };

  const resetAll = () => {
    for (const s of SLIDERS) document.documentElement.style.removeProperty(s.key);
    setTouched({});
  };

  const copyCSS = async () => {
    const bySelector = new Map<string, string[]>();
    for (const s of SLIDERS) {
      if (!(s.key in touched)) continue;
      const lines = bySelector.get(s.selector) ?? [];
      // The button-padding slider drives BOTH padding-left and
      // padding-right off one var (see OVERRIDE_CSS) -- print both, not
      // just the first half of the "padding-left/right" label. The earlier
      // version of this silently dropped padding-right from the output.
      const props = s.prop === 'padding-left/right' ? ['padding-left', 'padding-right'] : [s.prop.split(' ')[0]];
      for (const prop of props) lines.push(`  ${prop}: ${touched[s.key]}${s.unit};`);
      bySelector.set(s.selector, lines);
    }
    const blocks = [...bySelector.entries()]
      .map(([selector, lines]) => `${selector} {\n${lines.join('\n')}\n}`)
      .join('\n\n');
    const css = blocks || '/* Nothing moved yet -- drag a slider first. */';
    await navigator.clipboard.writeText(css);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const groups = [...new Set(SLIDERS.map((s) => s.group))];

  return (
    <div className="signin-debug-root">
      <style>{OVERRIDE_CSS}</style>

      <div className="signin-debug-bar" role="toolbar" aria-label="Preview state">
        {STATES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={state === s.id ? 'is-active' : undefined}
            onClick={() => setState(s.id)}
          >
            {s.label}
          </button>
        ))}
        <button
          type="button"
          className={drawerOpen ? 'is-active adjust-toggle' : 'adjust-toggle'}
          onClick={() => setDrawerOpen((open) => !open)}
        >
          🎚️ Adjust
        </button>
      </div>

      {drawerOpen && (
        <div className="signin-debug-drawer">
          <div className="signin-debug-drawer-actions">
            <button type="button" onClick={resetAll}>Reset all</button>
            <button type="button" className="primary" onClick={copyCSS}>
              {copied ? 'Copied ✓' : 'Copy CSS'}
            </button>
          </div>
          <div className="signin-debug-tabs" role="tablist" aria-label="Slider group">
            {groups.map((group) => (
              <button
                key={group}
                type="button"
                role="tab"
                aria-selected={activeGroup === group}
                className={activeGroup === group ? 'is-active' : undefined}
                onClick={() => setActiveGroup(group)}
              >
                {group}
              </button>
            ))}
          </div>
          <div className="signin-debug-group">
            {SLIDERS.filter((s) => s.group === activeGroup).map((s) => {
              const value = touched[s.key] ?? s.def;
              return (
                <label className="signin-debug-slider" key={s.key}>
                  <span className="signin-debug-slider-row">
                    <span>{s.label}</span>
                    <code>{value}{s.unit}</code>
                  </span>
                  <input
                    type="range"
                    min={s.min}
                    max={s.max}
                    value={value}
                    onChange={(e) => setVar(s.key, Number(e.target.value), s.unit)}
                  />
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Everything below reproduces poker-app.tsx's real unauthenticated
          markup shape (app-root > app-entry-sky, then account-entry-page). */}
      <div className="app-root">
        <div className="entry-sky app-entry-sky" aria-hidden="true">
          <span className="entry-orb" />
          <span className="entry-orb" />
          <span className="entry-orb" />
          <span className="entry-orb" />
          <span className="entry-orb" />
        </div>
        <main className="account-entry-page">
          <EntryHero />
          <AccountEntryCard
            ready={state !== 'checking'}
            accountsAvailable={state !== 'no-accounts'}
            pending={false}
            profile={state === 'signed-in' ? FAKE_PROFILE : null}
            remember={remember}
            error={state === 'error' ? 'That email or password is not right. Try again.' : null}
            onRememberChange={setRemember}
            onSignIn={() => {}}
            onEmailSignIn={() => {}}
            onEmailSignUp={() => {}}
            onForgotPassword={() => {}}
            onContinueAccount={() => {}}
            onContinueAsGuest={() => {}}
            onSignOut={() => {}}
          />
        </main>
      </div>
    </div>
  );
}

/**
 * `!important` overrides on the real selectors, every property a
 * `var(--dbg-*, <real 04-lobby.css value>)`. Nothing here changes the
 * page until a slider sets one of these custom properties on <html> --
 * the fallback IS what's shipping.
 */
const OVERRIDE_CSS = `
.entry-hero {
  top: var(--dbg-hero-top, 40px) !important;
  width: var(--dbg-hero-width, 371px) !important;
  height: var(--dbg-hero-height, 230px) !important;
}
.entry-hero-center { width: var(--dbg-hero-center-width, 40%) !important; }
.entry-hero-side {
  width: var(--dbg-hero-side-width, 34%) !important;
  height: var(--dbg-hero-side-height, 82%) !important;
}
.entry-logo {
  width: var(--dbg-logo-width, 340px) !important;
  margin-bottom: var(--dbg-logo-margin, 3px) !important;
}
.account-entry-card h1 { font-size: var(--dbg-title-size, 25px) !important; }
.account-entry-card > .entry-head > p:not(.account-entry-status) {
  font-size: var(--dbg-desc-size, 13px) !important;
}
.account-entry-actions {
  gap: var(--dbg-actions-gap, 9px) !important;
  margin-top: var(--dbg-actions-margin, 8px) !important;
}
.account-primary-action, .account-oauth-action, .account-guest-action, .account-email-toggle {
  min-height: var(--dbg-button-height, 48px) !important;
  padding-left: var(--dbg-button-px, 12px) !important;
  padding-right: var(--dbg-button-px, 12px) !important;
  font-size: var(--dbg-button-text, 15px) !important;
}
.account-entry-page {
  padding-top: var(--dbg-page-pad-top, 198px) !important;
  padding-bottom: var(--dbg-page-pad-bottom, 40px) !important;
}
.entry-footer { padding-top: var(--dbg-footer-pad, 6px) !important; }
`;
