"use client";

/**
 * Makes the Android hardware back button act like in-app back instead of
 * whatever Capacitor's WebView does by default (which, unhandled, is closer
 * to a browser's own back -- and with no history to go back to at the app's
 * true root, exits the app on the very first press a player makes on a
 * fresh launch). Gated the same way service-worker registration already is
 * (Capacitor.isNativePlatform()); web and iOS never import @capacitor/app's
 * native listener at all, since `App.addListener` is a no-op stub off-
 * platform but there's no reason to pay for it.
 */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";

export function useAndroidBackButton() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;
    let remove: (() => void) | undefined;

    void import("@capacitor/app").then(async ({ App }) => {
      if (cancelled) return;
      // addListener itself resolves asynchronously (it round-trips to the
      // native side), so a cleanup that ran while this was pending would
      // otherwise leave a listener attached with nothing left holding its
      // handle -- checked again below rather than trusted from above.
      const handle = await App.addListener("backButton", () => {
        // Only true root exits -- everywhere else, the same back the player
        // already has (a table's leave button, a game's own back link, the
        // browser/webview history stack) gets one more way to reach it.
        if (pathname === "/") {
          void App.exitApp();
          return;
        }
        router.back();
      });
      if (cancelled) {
        void handle.remove();
        return;
      }
      remove = () => void handle.remove();
    });

    return () => {
      cancelled = true;
      remove?.();
    };
  }, [pathname, router]);
}
