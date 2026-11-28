import type { Point } from "@/lib/stackacres-td/movement";

const SEEN_KEY = "stackacres.gates-seen";
/** How far in from the edge of the view a pointer sits. The left clears the tool rail, the top the HUD, the bottom the stick. */
const INSET = { left: 62, right: 10, top: 72, bottom: 112 } as const;
/** How far past the edge of the view a gate can be and still get a pointer, as a share of the view's longer side. */
const NEAR_VIEW = 0.15;
/** When the gate is in view the pointer sits this far above it, off the doorway. */
const LIFT = 30;

export interface GateTarget {
  /** The area it leads to: the exit's `to`. */
  to: string;
  label: string;
  /** The middle of the gate, in map units. */
  at: Point;
  /** The way through it, as a unit step: (-1, 0) for a gate on the west edge. */
  out: Point;
}

interface Pointer {
  el: HTMLButtonElement;
  /** Turns to face the gate. */
  arrow: HTMLSpanElement;
}

function readSeen(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * A label for each way out of the Homestead the farmer has not been through yet, saying what it leads to and
 * which way. It shows up as he nears the gate: over the gate once it is in view, and held on the edge of the view,
 * turned toward it, just before that. Far from every gate there is nothing, so nothing hangs in the middle of
 * the field. Tapping one walks him to its gate.
 *
 * Each goes away for good once he has been through that gate. What he has seen is the player's own convenience, so
 * it lives in this browser rather than on the farm. DOM in the host, like the speech bubbles, so it stays crisp.
 */
export class GatePointers {
  private pointers = new Map<string, Pointer>();
  private seen = readSeen();

  constructor(
    private readonly host: HTMLElement,
    private readonly toCss: (p: Point) => Point,
    private readonly onTap: (to: string) => void,
    private readonly reducedMotion: () => boolean,
  ) {}

  /** He has been through this one, so it is never pointed at again. */
  markSeen(to: string): void {
    if (this.seen.has(to)) return;
    this.seen.add(to);
    try {
      window.localStorage.setItem(SEEN_KEY, JSON.stringify([...this.seen]));
    } catch {
      // Private window: the pointers just come back next visit.
    }
    this.drop(to);
  }

  /** Lays the pointers out for this frame. `targets` is empty (or `show` false) wherever none belong. */
  update(targets: readonly GateTarget[], show: boolean): void {
    const wanted = show ? targets.filter((t) => !this.seen.has(t.to)) : [];
    for (const to of [...this.pointers.keys()]) {
      if (!wanted.some((t) => t.to === to)) this.drop(to);
    }
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (width === 0 || height === 0) return;
    const reach = Math.max(width, height) * NEAR_VIEW;
    for (const target of wanted) {
      const at = this.toCss(target.at);
      const outside = Math.hypot(Math.max(0, -at.x, at.x - width), Math.max(0, -at.y, at.y - height));
      if (outside > reach) {
        this.drop(target.to);
        continue;
      }
      const pointer = this.pointers.get(target.to) ?? this.make(target);
      const halfW = pointer.el.offsetWidth / 2;
      const halfH = pointer.el.offsetHeight / 2;
      // Along the line from the middle of the view to the gate, as far as the inset box lets it go.
      const cx = width / 2;
      const cy = height / 2 + (INSET.top - INSET.bottom) / 2;
      const dx = at.x - cx;
      const dy = at.y - cy;
      const roomX = Math.max(1, (dx < 0 ? cx - INSET.left : width - INSET.right - cx) - halfW);
      const roomY = Math.max(1, (dy < 0 ? cy - INSET.top : height - INSET.bottom - cy) - halfH);
      const t = Math.min(roomX / Math.max(1, Math.abs(dx)), roomY / Math.max(1, Math.abs(dy)), 1);
      // Whole, so the gate is inside the box: the label stands over it, pointing the way through.
      const over = t === 1;
      pointer.el.style.left = `${Math.round(cx + dx * t)}px`;
      pointer.el.style.top = `${Math.round(cy + dy * t - (over ? LIFT : 0))}px`;
      const angle = over ? Math.atan2(target.out.y, target.out.x) : Math.atan2(dy, dx);
      pointer.arrow.style.transform = `rotate(${angle}rad)`;
    }
  }

  clear(): void {
    for (const to of [...this.pointers.keys()]) this.drop(to);
  }

  private drop(to: string): void {
    this.pointers.get(to)?.el.remove();
    this.pointers.delete(to);
  }

  private make(target: GateTarget): Pointer {
    const el = document.createElement("button");
    el.type = "button";
    el.dataset.gatePointer = target.to;
    el.setAttribute("aria-label", `Walk to ${target.label}`);
    Object.assign(el.style, {
      position: "absolute",
      transform: "translate(-50%, -50%)",
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "5px 9px 5px 11px",
      font: "800 13px/1 var(--font-sa-display, system-ui), system-ui, sans-serif",
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      whiteSpace: "nowrap",
      color: "#2a1c30",
      background: "#f4ecd8",
      border: "2px solid #2a1c30",
      borderRadius: "999px",
      boxShadow: "0 2px 0 rgba(20, 12, 28, 0.35)",
      cursor: "pointer",
      touchAction: "manipulation",
      zIndex: "4",
    } satisfies Partial<CSSStyleDeclaration>);
    const text = document.createElement("span");
    text.textContent = target.label;
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    Object.assign(arrow.style, { display: "inline-block", lineHeight: "0" } satisfies Partial<CSSStyleDeclaration>);
    const nudge = document.createElement("span");
    Object.assign(nudge.style, { display: "inline-block", lineHeight: "0" } satisfies Partial<CSSStyleDeclaration>);
    nudge.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 8h9M8 3l5 5-5 5" fill="none" stroke="#2a1c30" stroke-width="2.4" stroke-linecap="square"/></svg>';
    arrow.appendChild(nudge);
    el.append(text, arrow);
    // The scene reads taps off the host: a tap on this must not also be a tap on the ground under it.
    for (const type of ["pointerdown", "pointerup", "pointercancel", "pointermove"] as const) {
      el.addEventListener(type, (event) => event.stopPropagation());
    }
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      this.onTap(target.to);
    });
    // The nudge runs along the arrow, which is turned to face the gate.
    if (!this.reducedMotion()) {
      nudge.animate([{ transform: "translateX(0)" }, { transform: "translateX(3px)" }, { transform: "translateX(0)" }], {
        duration: 1100,
        iterations: Infinity,
      });
    }
    this.host.appendChild(el);
    const pointer = { el, arrow };
    this.pointers.set(target.to, pointer);
    return pointer;
  }
}
