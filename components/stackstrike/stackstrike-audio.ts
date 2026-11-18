import * as Phaser from "phaser";
import { ALL_SOUNDS, MUSIC_TRACKS, MusicDirector, type Cue, type MusicInput, type MusicMix } from "@/lib/stackstrike/audio";

const DIR = "/stackstrike/audio";
/** Loudest the music gets, before the master mute. Sound effects sit above it. */
const MUSIC_VOLUME = 0.5;
const HEART_VOLUME = 0.55;
/** Most sounds that may be playing at once; a long burst of fire is cut off here rather than choking a phone. */
const MAX_VOICES = 24;

/**
 * Plays what lib/stackstrike/audio.ts decides. Sound effects are loaded with the scene; the
 * music loads after the first frame so the game starts without waiting for it.
 */
export class StackStrikeAudio {
  private readonly director = new MusicDirector();
  private stealth: Phaser.Sound.BaseSound | null = null;
  private hunted: Phaser.Sound.BaseSound | null = null;
  private heartSlow: Phaser.Sound.BaseSound | null = null;
  private heartFast: Phaser.Sound.BaseSound | null = null;
  private voices = 0;
  private musicRequested = false;

  constructor(private readonly scene: Phaser.Scene) {}

  /** Queues every sound effect to load. Call from the scene's preload. */
  static preload(scene: Phaser.Scene): void {
    for (const name of ALL_SOUNDS) scene.load.audio(`ss-${name}`, `${DIR}/${name}.wav`);
  }

  /** Loads the music in the background, then starts the loops silent so the director can fade them in. */
  startMusic(): void {
    if (this.musicRequested) return;
    this.musicRequested = true;
    for (const name of MUSIC_TRACKS) this.scene.load.audio(`ss-${name}`, `${DIR}/${name}.mp3`);
    this.scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.stealth = this.loop("music-stealth");
      this.hunted = this.loop("music-hunted");
      this.heartSlow = this.loop("heart-slow");
      this.heartFast = this.loop("heart-fast");
    });
    this.scene.load.start();
  }

  private loop(name: string): Phaser.Sound.BaseSound | null {
    if (!this.scene.cache.audio.exists(`ss-${name}`)) return null;
    const sound = this.scene.sound.add(`ss-${name}`, { loop: true, volume: 0 });
    sound.play();
    return sound;
  }

  /** Plays each cue. A cue with a delay waits on the scene's clock, so a pause holds it too. */
  play(cues: readonly Cue[]): void {
    for (const cue of cues) {
      const key = `ss-${cue.name}`;
      if (!this.scene.cache.audio.exists(key)) continue;
      if (this.voices >= MAX_VOICES) return;
      const config = { volume: cue.volume, rate: cue.rate, pan: cue.pan };
      const start = () => {
        this.voices += 1;
        const sound = this.scene.sound.add(key, config);
        sound.once(Phaser.Sound.Events.COMPLETE, () => {
          this.voices = Math.max(0, this.voices - 1);
          sound.destroy();
        });
        sound.play();
      };
      if (cue.delay > 0) this.scene.time.delayedCall(cue.delay * 1000, start);
      else start();
    }
  }

  /** Moves the music layers toward where the game says they should be. */
  update(dt: number, input: MusicInput): MusicMix {
    const mix = this.director.update(dt, input);
    this.set(this.stealth, mix.stealth * MUSIC_VOLUME);
    this.set(this.hunted, mix.hunted * MUSIC_VOLUME);
    this.set(this.heartSlow, mix.heartSlow * HEART_VOLUME);
    this.set(this.heartFast, mix.heartFast * HEART_VOLUME);
    return mix;
  }

  private set(sound: Phaser.Sound.BaseSound | null, volume: number): void {
    if (sound && "setVolume" in sound) (sound as Phaser.Sound.WebAudioSound).setVolume(volume);
  }

  /** A new run: the music starts again from calm. */
  reset(): void {
    this.director.reset();
  }

  setMuted(muted: boolean): void {
    this.scene.sound.mute = muted;
  }

  setPaused(paused: boolean): void {
    if (paused) this.scene.sound.pauseAll();
    else this.scene.sound.resumeAll();
  }
}
