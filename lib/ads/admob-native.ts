"use client";

/**
 * The native (Capacitor) app's rewarded-video ad, wrapping
 * @capacitor-community/admob. Web never imports this module -- see
 * rewarded-ad-modal.tsx's Capacitor.isNativePlatform() branch -- so nothing
 * here needs a browser fallback.
 *
 * What this module does NOT do: decide whether Gold gets credited. It only
 * shows a video and reports whether AdMob's on-device SDK says the player
 * earned the reward. The credit itself happens over Google's own
 * server-to-server SSV callback (lib/server/admob-ssv-service.ts), which
 * this device never sees -- see watchNativeRewardedAd's return value and the
 * modal's poll of /api/profile/gold/admob-status for why "the ad finished"
 * and "the balance moved" are two different moments.
 */

export interface NativeRewardedAdResult {
  /** AdMob's on-device SDK confirms the reward was earned. Not the credit -- see the module doc comment. */
  earned: boolean;
}

let initialized = false;

async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  const { AdMob } = await import("@capacitor-community/admob");
  await AdMob.initialize();
  initialized = true;
}

/**
 * Loads and shows the rewarded-video unit, resolving once the SDK reports
 * the outcome. Races showRewardVideoAd's own reward-earned resolution
 * against the Dismissed event, because a player who closes the ad early gets
 * no reward and showRewardVideoAd's promise is documented to resolve only on
 * an earned reward -- without the race, an early close would hang the caller
 * forever instead of resolving `{ earned: false }`.
 */
export async function watchNativeRewardedAd(
  adUnitId: string,
  ssv: { userId: string; customData: string },
  isTesting = false,
): Promise<NativeRewardedAdResult> {
  await ensureInitialized();
  const { AdMob, RewardAdPluginEvents } = await import("@capacitor-community/admob");

  await AdMob.prepareRewardVideoAd({ adId: adUnitId, ssv, isTesting });

  return new Promise<NativeRewardedAdResult>((resolve, reject) => {
    let settled = false;
    const handles: Array<Promise<{ remove: () => Promise<void> }>> = [];

    const finish = (result: NativeRewardedAdResult | Error) => {
      if (settled) return;
      settled = true;
      void Promise.all(handles).then((registered) => {
        registered.forEach((handle) => void handle.remove());
      });
      if (result instanceof Error) reject(result);
      else resolve(result);
    };

    handles.push(AdMob.addListener(RewardAdPluginEvents.Dismissed, () => finish({ earned: false })));
    handles.push(AdMob.addListener(RewardAdPluginEvents.FailedToShow, (error) => finish(new Error(error.message))));

    AdMob.showRewardVideoAd()
      .then(() => finish({ earned: true }))
      .catch((error) => finish(error instanceof Error ? error : new Error("Could not show the ad.")));
  });
}
