"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";
import Link from "next/link";

/**
 * The one dropdown in the app.
 *
 * M4 strips the table HUD down to logo / Leave Table / avatar, which means
 * everything else -- the room code, sound, hand history, Collection, the Gold
 * store, sign out -- has to live somewhere. This is that somewhere, so it is
 * built once, properly, rather than as a div that happens to appear on click.
 *
 * Deliberately dependency-free: this codebase carries no UI library and the
 * menu pattern is small enough that adding one would cost more than it saves.
 * What it does owe the player is the behaviour a native menu has -- Escape,
 * click-away, arrow keys, and focus that goes back where it came from. A menu
 * you can open with a keyboard but not close with one is worse than no menu.
 */

export type MenuItem =
  | { kind: "link"; label: string; href: string; icon?: React.ReactNode }
  // `disabled` states a fact rather than hiding one: "Daily Gold claimed" is
  // worth saying, and a row that vanishes on the day you use it reads as the
  // menu having lost an entry.
  | { kind: "action"; label: string; onSelect: () => void; icon?: React.ReactNode; tone?: "danger"; disabled?: boolean }
  | { kind: "separator" };

const isFocusable = (item: MenuItem) => item.kind !== "separator";

export function Menu({
  label,
  trigger,
  items,
  align = "end",
}: {
  /** Accessible name for the trigger, e.g. "Open player menu". */
  label: string;
  trigger: React.ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const menuId = useId();

  const focusableIndexes = items.flatMap((item, index) => (isFocusable(item) ? [index] : []));

  /**
   * Closing always returns focus to the trigger. Without this a keyboard user
   * who presses Escape is dropped at the top of the document and has to tab
   * back through the entire header to get where they were.
   */
  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    setActiveIndex(-1);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Pointer-down rather than click: a click listener fires after the button
  // that was pressed has already acted, which makes selecting an item outside
  // the menu feel like it needed two taps.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  /**
   * Escape is bound to the document, not to the panel.
   *
   * Opening with a mouse leaves focus on the trigger, which is outside the
   * panel -- so a handler that only sits on the panel never sees the key, and
   * Escape silently does nothing for anyone who clicked rather than tabbed.
   * Caught by tests/e2e/nav-menu.spec.ts; it is invisible in a screenshot,
   * because a menu that will not close still looks entirely correct.
   */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  // The table repositions on rotate and the menu is absolutely placed against
  // a header that moves with it, so a menu left open across an orientation
  // change ends up detached from its trigger. Closing is the honest fix.
  useEffect(() => {
    if (!open) return;
    const onLeave = () => close(false);
    window.addEventListener("orientationchange", onLeave);
    window.addEventListener("resize", onLeave);
    return () => {
      window.removeEventListener("orientationchange", onLeave);
      window.removeEventListener("resize", onLeave);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  const step = (delta: number) => {
    if (focusableIndexes.length === 0) return;
    const current = focusableIndexes.indexOf(activeIndex);
    const next = current === -1
      ? (delta > 0 ? 0 : focusableIndexes.length - 1)
      // Wraps deliberately: a menu is a ring, and stopping at the end is the
      // kind of detail that makes keyboard navigation feel broken.
      : (current + delta + focusableIndexes.length) % focusableIndexes.length;
    setActiveIndex(focusableIndexes[next]);
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(focusableIndexes[0] ?? -1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(focusableIndexes[focusableIndexes.length - 1] ?? -1);
    }
  };

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "ArrowDown":
        event.preventDefault();
        step(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        step(-1);
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(focusableIndexes[0] ?? -1);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(focusableIndexes[focusableIndexes.length - 1] ?? -1);
        break;
      case "Tab":
        // Tab leaves the menu rather than cycling inside it. This is a menu,
        // not a dialog: nothing here is modal, so trapping Tab would strand
        // someone who only wanted to move past it.
        close(false);
        break;
      default:
        break;
    }
  };

  return (
    <div className="app-menu" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="app-menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={onTriggerKeyDown}
      >
        {trigger}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className={clsx("app-menu-panel", align === "start" && "app-menu-panel-start")}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, index) => {
            if (item.kind === "separator") {
              return <hr key={`sep-${index}`} className="app-menu-separator" aria-hidden="true" />;
            }
            const shared = {
              role: "menuitem" as const,
              className: clsx(
                "app-menu-item",
                item.kind === "action" && item.tone === "danger" && "app-menu-item-danger",
                item.kind === "action" && item.disabled && "app-menu-item-disabled",
              ),
              // Roving tabindex: only the active item is tabbable, so the menu
              // is one stop rather than one stop per entry.
              tabIndex: index === activeIndex ? 0 : -1,
              onMouseEnter: () => setActiveIndex(index),
            };
            // One child, not two. Spreading props alongside multiple children
            // makes React compile them as a dynamic list and ask for keys on
            // static content; a fragment keeps it a single static child.
            const content = <>{item.icon}<span>{item.label}</span></>;
            if (item.kind === "link") {
              return (
                <Link
                  {...shared}
                  key={item.label}
                  href={item.href}
                  ref={(el) => { itemRefs.current[index] = el; }}
                  onClick={() => close(false)}
                >
                  {content}
                </Link>
              );
            }
            return (
              <button
                {...shared}
                key={item.label}
                type="button"
                // aria-disabled, not `disabled`: a disabled button is skipped
                // by the roving tabindex above, so arrowing down the menu
                // would jump straight past "Daily Gold claimed" as though the
                // row were not there. It stays focusable and announces itself;
                // the click is what is refused.
                aria-disabled={item.disabled || undefined}
                ref={(el) => { itemRefs.current[index] = el; }}
                onClick={() => {
                  if (item.disabled) return;
                  close(false);
                  item.onSelect();
                }}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
