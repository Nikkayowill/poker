"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, Lock, Shirt, X } from "lucide-react";
import { isWearable, itemsFor, sameLook, wardrobeItem, withBody, withColour, withItem } from "@/lib/stackacres/wardrobe/look";
import {
  OPTIONAL_SLOTS,
  type FarmerLook,
  type FarmerWardrobeState,
  type WardrobeBody,
  type WardrobeCatalogue,
  type WardrobeItem,
  type WardrobeSlot,
} from "@/lib/stackacres/wardrobe/types";

/**
 * The wardrobe: the farmer's look, changed at the looking-glass in the
 * farmhouse, and once on a first visit as "make your farmer". Everything in
 * the starter set is free; an extra with a price can be tried on free and is
 * bought once to keep. Four saved outfits, Habbo style.
 */

type Tab = WardrobeSlot | "body" | "outfits";

const TABS: { id: Tab; label: string }[] = [
  { id: "body", label: "Body" },
  { id: "hair", label: "Hair" },
  { id: "hat", label: "Hat" },
  { id: "top", label: "Top" },
  { id: "over", label: "Overalls" },
  { id: "bottom", label: "Bottoms" },
  { id: "shoes", label: "Shoes" },
  { id: "face", label: "Extras" },
  { id: "outfits", label: "Outfits" },
];

/** Which way the preview faces, in turn order. Frames follow farmer.json's standing frames. */
const FACINGS = ["down", "left", "up", "right"] as const;

export interface WardrobeSheetProps {
  catalogue: WardrobeCatalogue;
  state: FarmerWardrobeState;
  /** Owned paid items, as player_cosmetics ids. */
  owned: ReadonlySet<string>;
  gold: number;
  /** First visit: "make your farmer", and skipping keeps today's farmer. */
  first: boolean;
  /** The standing frames of a look, down/left/up/right. */
  renderPreview: (look: FarmerLook) => Promise<readonly HTMLCanvasElement[]>;
  /** Each resolves to an error to show, or null when it went through. */
  onSave: (look: FarmerLook) => Promise<string | null>;
  onSaveOutfit: (slot: number, look: FarmerLook | null) => Promise<string | null>;
  onBuy: (itemId: string) => Promise<string | null>;
  onClose: () => void;
}

function Preview({ look, facing, render }: { look: FarmerLook; facing: number; render: WardrobeSheetProps["renderPreview"] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [frames, setFrames] = useState<readonly HTMLCanvasElement[] | null>(null);
  useEffect(() => {
    let live = true;
    // A burst of taps through the swatches only bakes the last one.
    const timer = window.setTimeout(() => {
      void render(look).then((next) => {
        if (live) setFrames(next);
      });
    }, 60);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [look, render]);
  useEffect(() => {
    const canvas = ref.current;
    const frame = frames?.[facing];
    if (!canvas || !frame) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(frame, 0, 0);
  }, [frames, facing]);
  return <canvas ref={ref} width={48} height={48} className="sa-wardrobe-figure" aria-label="Your farmer" role="img" />;
}

export function WardrobeSheet({
  catalogue,
  state,
  owned,
  gold,
  first,
  renderPreview,
  onSave,
  onSaveOutfit,
  onBuy,
  onClose,
}: WardrobeSheetProps) {
  const [look, setLook] = useState<FarmerLook>(state.look);
  const [tab, setTab] = useState<Tab>("body");
  const [facing, setFacing] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** A price asks twice: the first tap arms it, the second pays. */
  const [armed, setArmed] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !first) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [first, onClose]);

  const unowned = useMemo(
    () =>
      Object.values(look.picks)
        .map((pick) => (pick.item ? wardrobeItem(catalogue, pick.item) : null))
        .filter((item): item is WardrobeItem => item !== null && !isWearable(item, owned)),
    [catalogue, look, owned],
  );

  const run = async (work: () => Promise<string | null>, done?: () => void) => {
    setBusy(true);
    setNote(null);
    const error = await work().catch(() => "That did not go through.");
    setBusy(false);
    if (error) setNote(error);
    else done?.();
  };

  const slot: WardrobeSlot | null = tab === "body" || tab === "outfits" ? null : tab;
  const items = slot ? itemsFor(catalogue, slot, look.body) : [];
  const picked = slot ? look.picks[slot] : null;
  const pickedItem = picked?.item ? wardrobeItem(catalogue, picked.item) : null;

  const swatches = (target: WardrobeSlot) => {
    const item = look.picks[target].item ? wardrobeItem(catalogue, look.picks[target].item!) : null;
    if (!item || item.colours.length === 0) return null;
    return (
      <div className="sa-wardrobe-swatches" role="radiogroup" aria-label="Colour">
        {item.colours.map((id) => {
          const colour = catalogue.colours[id];
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={look.picks[target].colour === id}
              aria-label={colour?.label ?? id}
              title={colour?.label ?? id}
              className={clsx("sa-wardrobe-swatch", look.picks[target].colour === id && "is-on")}
              style={{ background: colour?.swatch ?? "#888" }}
              onClick={() => setLook(withColour(look, target, id))}
            />
          );
        })}
      </div>
    );
  };

  const setBody = (body: WardrobeBody) => setLook(withBody(look, body, catalogue));

  return (
    <div className="sa-store-scrim sa-wardrobe-scrim" role="dialog" aria-modal="true" aria-label={first ? "Make your farmer" : "Wardrobe"}>
      <div className="sa-store-card sa-wardrobe-card">
        <header className="sa-store-head">
          <Shirt size={20} aria-hidden="true" />
          <h2>{first ? "Make your farmer" : "The Looking-Glass"}</h2>
          {!first && (
            <button type="button" className="sa-store-close" aria-label="Close" onClick={onClose}>
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </header>

        <div className="sa-wardrobe-body">
          <div className="sa-wardrobe-stage">
            <Preview look={look} facing={facing} render={renderPreview} />
            <div className="sa-wardrobe-turn">
              <button type="button" aria-label="Turn left" onClick={() => setFacing((facing + 3) % 4)}>
                <ChevronLeft size={22} aria-hidden="true" />
              </button>
              <span>{FACINGS[facing] === "down" ? "Front" : FACINGS[facing] === "up" ? "Back" : "Side"}</span>
              <button type="button" aria-label="Turn right" onClick={() => setFacing((facing + 1) % 4)}>
                <ChevronRight size={22} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="sa-wardrobe-picker">
            <div className="sa-store-tabs" role="tablist" aria-label="Part">
              {TABS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  className={clsx("sa-store-tab", tab === id && "sa-store-tab-active")}
                  onClick={() => {
                    setTab(id);
                    setArmed(null);
                  }}
                >
                  <span>{label}</span>
                </button>
              ))}
            </div>

            <div className="sa-store-panel sa-wardrobe-panel" role="tabpanel">
              {tab === "body" && (
                <>
                  <div className="sa-wardrobe-choices" role="radiogroup" aria-label="Body">
                    {(["male", "female"] as const).map((body) => (
                      <button
                        key={body}
                        type="button"
                        role="radio"
                        aria-checked={look.body === body}
                        className={clsx("sa-wardrobe-choice", look.body === body && "is-on")}
                        onClick={() => setBody(body)}
                      >
                        {body === "male" ? "Male" : "Female"}
                      </button>
                    ))}
                  </div>
                  <p className="sa-wardrobe-label">Skin</p>
                  {swatches("skin")}
                  <p className="sa-wardrobe-label">Eyes</p>
                  {swatches("eyes")}
                </>
              )}

              {slot && (
                <>
                  <div className="sa-wardrobe-choices" role="radiogroup" aria-label={TABS.find((t) => t.id === slot)?.label}>
                    {OPTIONAL_SLOTS.includes(slot) && (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={picked?.item === null}
                        className={clsx("sa-wardrobe-choice", picked?.item === null && "is-on")}
                        onClick={() => setLook(withItem(look, slot, null))}
                      >
                        None
                      </button>
                    )}
                    {items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="radio"
                        aria-checked={picked?.item === item.id}
                        className={clsx("sa-wardrobe-choice", picked?.item === item.id && "is-on")}
                        onClick={() => {
                          setLook(withItem(look, slot, item));
                          setArmed(null);
                        }}
                      >
                        {item.label}
                        {!isWearable(item, owned) && (
                          <em className="sa-wardrobe-price">
                            <Lock size={11} aria-hidden="true" /> {item.price?.toLocaleString()}
                          </em>
                        )}
                      </button>
                    ))}
                  </div>
                  {swatches(slot)}
                  {pickedItem && !isWearable(pickedItem, owned) && (
                    <div className="sa-wardrobe-buy">
                      <p>
                        Trying it on is free. Buy the {pickedItem.label} for {pickedItem.price?.toLocaleString()} Gold to keep it.
                      </p>
                      <button
                        type="button"
                        className="sa-cta"
                        disabled={busy || gold < (pickedItem.price ?? 0)}
                        onClick={() => {
                          if (armed !== pickedItem.id) {
                            setArmed(pickedItem.id);
                            return;
                          }
                          setArmed(null);
                          void run(() => onBuy(pickedItem.id));
                        }}
                      >
                        {gold < (pickedItem.price ?? 0)
                          ? `Needs ${pickedItem.price?.toLocaleString()} Gold`
                          : armed === pickedItem.id
                            ? `Tap again to pay ${pickedItem.price?.toLocaleString()} Gold`
                            : `Buy · ${pickedItem.price?.toLocaleString()} Gold`}
                      </button>
                    </div>
                  )}
                </>
              )}

              {tab === "outfits" && (
                <ol className="sa-wardrobe-outfits">
                  {state.outfits.map((outfit, index) => (
                    <li key={index}>
                      <strong>Outfit {index + 1}</strong>
                      {outfit ? (
                        <>
                          <button type="button" className="sa-cta" disabled={busy} onClick={() => setLook(outfit)}>
                            Wear
                          </button>
                          <button type="button" className="sa-wardrobe-link" disabled={busy} onClick={() => void run(() => onSaveOutfit(index, null))}>
                            Clear
                          </button>
                        </>
                      ) : (
                        <span className="sa-wardrobe-empty">Empty</span>
                      )}
                      <button
                        type="button"
                        className="sa-wardrobe-link"
                        disabled={busy || unowned.length > 0 || (outfit !== null && sameLook(outfit, look))}
                        onClick={() => void run(() => onSaveOutfit(index, look))}
                      >
                        Save this look here
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>

        {note && (
          <p className="sa-wardrobe-note" role="alert">
            {note}
          </p>
        )}
        <footer className="sa-wardrobe-foot">
          {first && (
            <button type="button" className="sa-wardrobe-link" disabled={busy} onClick={() => void run(() => onSave(state.look), onClose)}>
              Keep this farmer
            </button>
          )}
          {unowned.length > 0 && (
            <span className="sa-wardrobe-hint">Buy or take off the {unowned.map((item) => item.label).join(" and ")} to keep this look.</span>
          )}
          <button
            type="button"
            className="sa-cta"
            disabled={busy || unowned.length > 0 || (!first && sameLook(look, state.look))}
            onClick={() => void run(() => onSave(look), onClose)}
          >
            {first ? "Start farming" : "Wear this"}
          </button>
        </footer>
      </div>
    </div>
  );
}
