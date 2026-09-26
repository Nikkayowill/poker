"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Coins, Store, UserPlus, Users, X, type LucideIcon } from "lucide-react";
import type { Action } from "@/lib/stackacres/farm-actions";
import { noPostFor, type GroceryView } from "@/lib/stackacres/grocery";
import { JOB_LABELS, hiringFee, hourlyWage, ratings, traitNotes } from "@/lib/stackacres/grocery-crew";
import { GROCERY_ECONOMY, HOLD_UP_ADVICE, readTill, type HoldUp } from "@/lib/stackacres/grocery-economy";
import { storePerson, type StorePerson } from "@/lib/stackacres-td/store-cast";
import { StaffPortrait } from "./grocery-art";
import { StackAcresPixelIcon } from "./stackacres-pixel-icon";
import type { ContractActionResult } from "./TownContractsModal";

/**
 * The manager's desk at the city grocery (lib/stackacres/grocery.ts): the till, the staff, and today's Help
 * Wanted board, as one tabbed popup like the house's. The desk opens it on the till; the board on the wall opens
 * it on hiring; tapping someone at work opens it on the staff, with them picked out.
 *
 * Every number here is the server's (the view), except the till, which is worked out every second from the
 * same rates the server uses, so it climbs while the popup is open. Each press waits for the server; a refusal
 * is said under the thing that was pressed.
 */

export type DeskTab = "till" | "staff" | "hiring";

const TABS: readonly { id: DeskTab; label: string; icon: LucideIcon }[] = [
  { id: "till", label: "Till", icon: Coins },
  { id: "staff", label: "Staff", icon: Users },
  { id: "hiring", label: "Hiring", icon: UserPlus },
];

export interface GroceryDeskProps {
  grocery: GroceryView;
  tab: DeskTab;
  onTab: (tab: DeskTab) => void;
  /** Someone tapped in the shop, picked out on the staff tab. */
  focus: string | null;
  gold: number;
  unlimitedGold: boolean;
  act: (action: Action) => Promise<ContractActionResult>;
  /** The server's now in ms, which the till is read against. */
  serverNowMs: () => number;
  /** Close the desk and start arranging the shop, with the tray open. */
  onArrange: () => void;
  onClose: () => void;
}

const firstName = (person: StorePerson) => person.label.split(",")[0];
const gold = (n: number) => Math.round(n).toLocaleString();

function Stars({ count, label }: { count: number; label: string }) {
  return (
    <span className="sa-grocery-stars" aria-label={`${label}: ${count} of 5`} title={label}>
      <span className="sa-grocery-stars-label">{label}</span>
      <span className="sa-grocery-stars-row" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className={clsx("sa-grocery-star", i < count && "is-on")} />
        ))}
      </span>
    </span>
  );
}

function PersonFacts({ person }: { person: StorePerson }) {
  return (
    <>
      <div className="sa-grocery-ratings">
        {ratings(person.profile).map((rating) => (
          <Stars key={rating.label} count={rating.stars} label={rating.label} />
        ))}
      </div>
      {person.profile.traits.length > 0 && (
        <ul className="sa-grocery-traits">
          {traitNotes(person.profile).map((note) => (
            <li key={note.trait} className={clsx("sa-grocery-trait", note.good ? "is-good" : "is-bad")}>
              <strong>{note.label}</strong> {note.blurb}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** The till, read again every second, against the server's clock. */
function useTill(grocery: GroceryView, serverNowMs: () => number) {
  const [now, setNow] = useState(serverNowMs);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(serverNowMs()), 1000);
    return () => window.clearInterval(timer);
  }, [serverNowMs]);
  return { ...readTill(grocery.till, grocery.rates, new Date(now)), now };
}

function TillTab({
  grocery,
  act,
  serverNowMs,
  onHire,
  onArrange,
}: {
  grocery: GroceryView;
  act: GroceryDeskProps["act"];
  serverNowMs: () => number;
  onHire: () => void;
  onArrange: () => void;
}) {
  const till = useTill(grocery, serverNowMs);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; good: boolean } | null>(null);
  const { rates } = grocery;
  const opened = Date.parse(grocery.till.openedAt);
  const fullAt = Date.parse(till.fullAt);
  const filled = Math.min(1, Math.max(0, (till.now - opened) / (fullAt - opened)));
  const hoursLeft = Math.max(1, Math.round((fullAt - till.now) / 3_600_000));
  const canEmpty = till.pay > 0 || till.full;

  const empty = async () => {
    // The server's own figure once it answers; the till's live estimate only stands in while waiting.
    const guess = till.pay;
    setBusy(true);
    setSaid(null);
    const result = await act({ action: "grocery-collect" });
    setBusy(false);
    if (!result.ok) {
      setSaid({ text: result.message, good: false });
      return;
    }
    const pay = result.groceryPaid ?? guess;
    setSaid({ text: pay > 0 ? `${gold(pay)} Gold went into your wallet.` : "The wages took it all this time.", good: pay > 0 });
  };

  const holdUp: HoldUp | null = rates.holdUp;
  const hireFix = holdUp === "hire-cashier" || holdUp === "hire-produce" || holdUp === "hire-stocker";
  const appealShare = rates.appealBonus / GROCERY_ECONOMY.appealMax;

  return (
    <div className="sa-grocery-till">
      <section className={clsx("sa-grocery-card sa-grocery-advice", holdUp && "is-hold")} aria-label="What to do next">
        <div className="sa-grocery-advice-text">
          <p className="sa-grocery-kicker">{holdUp ? "What's holding the shop back" : "Running smoothly"}</p>
          <p>{holdUp ? HOLD_UP_ADVICE[holdUp] : "Every shopper is getting what they came for. Add decor to bring more in."}</p>
        {rates.idle.length > 0 && (
          <p className="sa-grocery-note is-warn">
            {rates.idle.map((name) => firstName(storePerson(name)!)).join(" and ")} {rates.idle.length === 1 ? "has" : "have"} no post to work
            but {rates.idle.length === 1 ? "is" : "are"} still paid.
          </p>
        )}
        </div>
        <div className="sa-grocery-advice-keys">
          {(holdUp === null || !hireFix) && (
            <button type="button" className="sa-cta" onClick={onArrange}>
              Arrange the shop
            </button>
          )}
          {hireFix && (
            <button type="button" className="sa-cta" onClick={onHire}>
              See who&apos;s hiring
            </button>
          )}
        </div>
      </section>

      <section className="sa-grocery-card sa-grocery-till-card" aria-label="The till">
        <p className="sa-grocery-kicker">In the till</p>
        <p className="sa-grocery-till-amount">
          <StackAcresPixelIcon name="coin" />
          <strong>{gold(till.pay)}</strong>
        </p>
        <p className="sa-grocery-till-split">
          Takings {gold(till.takings)} <span aria-hidden="true">·</span> Wages {gold(till.wages)}
        </p>
        <div className="sa-grocery-bar" role="progressbar" aria-label="How full the till is" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(filled * 100)}>
          <span style={{ width: `${filled * 100}%` }} />
        </div>
        <p className={clsx("sa-grocery-note", till.full && "is-warn")}>
          {till.full
            ? "The till is full, so the shop has shut. Empty it to open again."
            : `It holds a day of takings. Full in about ${hoursLeft} ${hoursLeft === 1 ? "hour" : "hours"}.`}
        </p>
        <button type="button" className="sa-cta sa-grocery-empty" disabled={!canEmpty || busy} onClick={empty}>
          {busy ? "Emptying…" : "Empty the till"}
        </button>
        {said && (
          <p className={clsx("sa-grocery-said", said.good ? "is-good" : "is-bad")} role="status">
            {said.text}
          </p>
        )}
      </section>

      <section className="sa-grocery-card" aria-label="Each hour">
        <p className="sa-grocery-kicker">Each hour</p>
        <dl className="sa-grocery-hourly">
          <div>
            <dt>Takings</dt>
            <dd>+{gold(rates.takingsPerHour)}</dd>
          </div>
          <div>
            <dt>Wages</dt>
            <dd>−{gold(rates.wagesPerHour)}</dd>
          </div>
          <div className={rates.netPerHour >= 0 ? "is-good" : "is-bad"}>
            <dt>You keep</dt>
            <dd>
              {rates.netPerHour >= 0 ? "+" : "−"}
              {gold(Math.abs(rates.netPerHour))}
            </dd>
          </div>
        </dl>
        {rates.netPerHour < 0 && <p className="sa-grocery-note is-warn">The staff cost more than the shop sells. The till won&apos;t pay out until that changes.</p>}
      </section>

      <section className="sa-grocery-card" aria-label="How the shop is doing">
        <p className="sa-grocery-kicker">How the shop is doing</p>
        <div className="sa-grocery-meter">
          <span>Service</span>
          <div className="sa-grocery-bar" aria-hidden="true">
            <span style={{ width: `${rates.service * 100}%` }} />
          </div>
          <strong>{Math.round(rates.service * 100)}%</strong>
        </div>
        <p className="sa-grocery-note">Of what shoppers came in for, how much they got.</p>
        <div className="sa-grocery-meter">
          <span>Appeal</span>
          <div className="sa-grocery-bar is-appeal" aria-hidden="true">
            <span style={{ width: `${appealShare * 100}%` }} />
          </div>
          <strong>+{Math.round(rates.appealBonus * 100)}%</strong>
        </div>
        <p className="sa-grocery-note">Decor brings in more shoppers, up to +{Math.round(GROCERY_ECONOMY.appealMax * 100)}%.</p>
      </section>

      <p className="sa-grocery-foot">Collected so far: {gold(grocery.collected)} Gold</p>
    </div>
  );
}

function StaffTab({ grocery, focus, act }: { grocery: GroceryView; focus: string | null; act: GroceryDeskProps["act"] }) {
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refused, setRefused] = useState<{ name: string; text: string } | null>(null);
  const focusRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus]);
  const idle = new Set(grocery.rates.idle);

  const letGo = async (name: string) => {
    setBusy(name);
    setRefused(null);
    const result = await act({ action: "grocery-fire", name });
    setBusy(null);
    setAsking(null);
    if (!result.ok) setRefused({ name, text: result.message });
  };

  return (
    <div>
      <p className="sa-grocery-intro">
        {grocery.staff.length} {grocery.staff.length === 1 ? "person works" : "people work"} here. Wages come to{" "}
        <strong>{gold(grocery.rates.wagesPerHour)} Gold an hour</strong>, paid from the till.
      </p>
      {grocery.staff.length === 0 && <p className="sa-grocery-note is-warn">Nobody works here, so nothing sells. Hire someone from the board.</p>}
      <ul className="sa-grocery-people">
        {grocery.staff.map((name) => {
          const person = storePerson(name);
          if (!person) return null;
          const first = firstName(person);
          return (
            <li key={name} ref={name === focus ? focusRef : undefined} className={clsx("sa-grocery-person", name === focus && "is-focus")}>
              <StaffPortrait name={name} />
              <div className="sa-grocery-person-about">
                <h3>{first}</h3>
                <p className="sa-grocery-job">{JOB_LABELS[person.job].one}</p>
                {idle.has(name) && <p className="sa-grocery-note is-warn">No post to work. Add a {person.job === "cashier" ? "checkout lane" : "produce island"}.</p>}
                <PersonFacts person={person} />
                <p className="sa-grocery-wage">Wage {hourlyWage(person)} Gold an hour</p>
                {refused?.name === name && <p className="sa-grocery-said is-bad">{refused.text}</p>}
              </div>
              <div className="sa-grocery-person-keys">
                {asking === name ? (
                  <>
                    <button type="button" className="sa-cta is-danger" disabled={busy === name} onClick={() => void letGo(name)}>
                      {busy === name ? "…" : `Let ${first} go`}
                    </button>
                    <button type="button" className="sa-sheet-close" onClick={() => setAsking(null)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button type="button" className="sa-sheet-close" onClick={() => setAsking(name)}>
                    Let go
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function HiringTab({ grocery, walletGold, unlimitedGold, act }: { grocery: GroceryView; walletGold: number; unlimitedGold: boolean; act: GroceryDeskProps["act"] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [refused, setRefused] = useState<{ name: string; text: string } | null>(null);
  const applicants = useMemo(() => grocery.applicants.map((name) => storePerson(name)).filter((p): p is StorePerson => !!p), [grocery.applicants]);

  const hire = async (person: StorePerson) => {
    setBusy(person.name);
    setRefused(null);
    const result = await act({ action: "grocery-hire", name: person.name });
    setBusy(null);
    if (!result.ok) setRefused({ name: person.name, text: result.message });
  };

  return (
    <div>
      <p className="sa-grocery-intro">Townsfolk looking for work today. New faces turn up tomorrow.</p>
      {applicants.length === 0 && <p className="sa-grocery-note">Nobody else is looking for work right now.</p>}
      <ul className="sa-grocery-applicants">
        {applicants.map((person) => {
          const first = firstName(person);
          const fee = hiringFee(person);
          const noPost = noPostFor(person, grocery);
          const short = !unlimitedGold && walletGold < fee ? fee - walletGold : 0;
          return (
            <li key={person.name} className="sa-grocery-applicant">
              <div className="sa-grocery-applicant-head">
                <StaffPortrait name={person.name} />
                <div>
                  <h3>{first}</h3>
                  <p className="sa-grocery-job">{JOB_LABELS[person.job].one}</p>
                </div>
              </div>
              <p className="sa-grocery-does">{JOB_LABELS[person.job].does}</p>
              <PersonFacts person={person} />
              <dl className="sa-grocery-terms">
                <div>
                  <dt>To hire</dt>
                  <dd>
                    <StackAcresPixelIcon name="coin" />
                    {gold(fee)}
                  </dd>
                </div>
                <div>
                  <dt>Wage</dt>
                  <dd>
                    <StackAcresPixelIcon name="coin" />
                    {hourlyWage(person)}
                    <small>/hour</small>
                  </dd>
                </div>
              </dl>
              {noPost && <p className="sa-grocery-note is-warn">{noPost}</p>}
              {refused?.name === person.name && <p className="sa-grocery-said is-bad">{refused.text}</p>}
              <button type="button" className="sa-cta" disabled={noPost !== null || short > 0 || busy !== null} onClick={() => void hire(person)}>
                {busy === person.name ? "Hiring…" : short > 0 ? `Need ${gold(short)} more Gold` : `Hire ${first}`}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function GroceryDesk({ grocery, tab, onTab, focus, gold: walletGold, unlimitedGold, act, serverNowMs, onArrange, onClose }: GroceryDeskProps) {
  const [taking, setTaking] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const takeOver = async () => {
    setTaking(true);
    const result = await act({ action: "grocery-take-over" });
    setTaking(false);
    if (!result.ok) setRefused(result.message);
  };

  return (
    <div
      className="sa-store-scrim sa-grocery-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="The manager's desk"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sa-store-card sa-grocery-desk">
        <header className="sa-store-head">
          <Store size={20} aria-hidden="true" className="sa-grocery-mark" />
          <h2>The Grocery</h2>
          {grocery.owned && (
            <span className="sa-grocery-head-staff" title="Who works here">
              <StackAcresPixelIcon name="workers" /> {grocery.staff.length}
            </span>
          )}
          <button type="button" className="sa-store-close" aria-label="Close" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        {!grocery.owned ? (
          <div className="sa-store-panel sa-grocery-unowned">
            <p className="sa-grocery-intro">The store&apos;s manager runs it for now. One day you&apos;ll be able to buy it from them.</p>
            <p className="sa-grocery-note">
              In development you can take it over now, with the crew of four it comes with, to try running it.
            </p>
            {refused && <p className="sa-grocery-said is-bad">{refused}</p>}
            <button type="button" className="sa-cta" disabled={taking} onClick={() => void takeOver()}>
              {taking ? "Taking over…" : "Take the store over (dev)"}
            </button>
          </div>
        ) : (
          <>
            <div className="sa-store-tabs" role="tablist" aria-label="The manager's desk">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  className={clsx("sa-store-tab", tab === id && "sa-store-tab-active")}
                  onClick={() => onTab(id)}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="sa-store-panel" role="tabpanel">
              {tab === "till" && (
                <TillTab grocery={grocery} act={act} serverNowMs={serverNowMs} onHire={() => onTab("hiring")} onArrange={onArrange} />
              )}
              {tab === "staff" && <StaffTab grocery={grocery} focus={focus} act={act} />}
              {tab === "hiring" && <HiringTab grocery={grocery} walletGold={walletGold} unlimitedGold={unlimitedGold} act={act} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
