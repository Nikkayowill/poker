import type { Point } from "@/lib/stackacres-td/movement";

const FADE_MS = 220;
/** Feet to the top of a head, in map px: the bubble's tail points at it. */
const ABOVE_HEAD = 34;

interface Bubble {
  el: HTMLDivElement;
  anchor: () => Point | null;
  born: number;
  ms: number;
}

/**
 * Speech bubbles over people who are talking to each other. DOM in the host, like the scene's floating text,
 * so the words stay crisp at any zoom. One per speaker: a new line from the other person takes theirs away
 * so the two never stack over each other, and a bubble follows its speaker until it fades.
 */
export class SpeechBubbles {
  private bubbles = new Map<string, Bubble>();

  constructor(
    private readonly host: HTMLElement,
    private readonly toCss: (p: Point) => Point,
  ) {}

  say(name: string, partner: string, text: string, ms: number, now: number, anchor: () => Point | null): void {
    this.drop(partner);
    this.drop(name);
    const el = document.createElement("div");
    el.setAttribute("role", "status");
    el.dataset.npcSpeech = name;
    Object.assign(el.style, {
      position: "absolute",
      transform: "translate(-50%, -100%)",
      pointerEvents: "none",
      maxWidth: "168px",
      width: "max-content",
      textAlign: "center",
      font: "700 13px/1.25 var(--font-sa-display, system-ui), system-ui, sans-serif",
      color: "#2a1c30",
      background: "#f4ecd8",
      border: "2px solid #2a1c30",
      borderRadius: "8px",
      padding: "4px 8px",
      boxShadow: "0 2px 0 rgba(20, 12, 28, 0.35)",
      zIndex: "5",
      opacity: "0",
      transition: `opacity ${FADE_MS}ms linear`,
    } satisfies Partial<CSSStyleDeclaration>);
    el.textContent = text;
    const tail = document.createElement("div");
    Object.assign(tail.style, {
      position: "absolute",
      left: "50%",
      bottom: "-6px",
      width: "8px",
      height: "8px",
      background: "#f4ecd8",
      borderRight: "2px solid #2a1c30",
      borderBottom: "2px solid #2a1c30",
      transform: "translateX(-50%) rotate(45deg)",
    } satisfies Partial<CSSStyleDeclaration>);
    el.appendChild(tail);
    this.host.appendChild(el);
    const bubble = { el, anchor, born: now, ms };
    this.bubbles.set(name, bubble);
    this.place(bubble);
    requestAnimationFrame(() => {
      el.style.opacity = "1";
    });
  }

  update(now: number): void {
    for (const [name, bubble] of this.bubbles) {
      const age = now - bubble.born;
      if (age >= bubble.ms + FADE_MS || !bubble.anchor()) {
        this.drop(name);
        continue;
      }
      if (age >= bubble.ms) bubble.el.style.opacity = "0";
      this.place(bubble);
    }
  }

  private place(bubble: Bubble): void {
    const at = bubble.anchor();
    if (!at) return;
    const css = this.toCss({ x: at.x, y: at.y - ABOVE_HEAD });
    bubble.el.style.left = `${Math.round(css.x)}px`;
    bubble.el.style.top = `${Math.round(css.y)}px`;
  }

  private drop(name: string): void {
    this.bubbles.get(name)?.el.remove();
    this.bubbles.delete(name);
  }

  clear(): void {
    for (const name of [...this.bubbles.keys()]) this.drop(name);
  }
}
