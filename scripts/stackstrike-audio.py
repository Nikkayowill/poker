"""Builds StackStrike's sound from CC0 sources into public/stackstrike/audio/.

Run: python3 scripts/stackstrike-audio.py --src <folder with the downloads> [--out public/stackstrike/audio]

The folder given to --src holds the unpacked CC0 downloads (see public/stackstrike/audio/CREDITS.md
for where each came from):
  firearms/Prepared SFX Library/...   The Free Firearm Sound Library (Ylmir)
  kenney/...                          Kenney's impact, interface and sci-fi sounds (via Godot mirrors)
  oga/...                             small OpenGameArt packs (heartbeats, alarm, reloads, static)
  music/...                           Electric City (glitchart) and the other music tracks

Sound effects come out as 16-bit mono WAV (no encoder delay, so a shot lands on the frame it is fired).
Music comes out as MP3 (plays everywhere, loops cheaply). Everything is deterministic.
"""
import argparse, json, os, subprocess, sys
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stackstrike_foley

SR = 44100
rng = np.random.default_rng(7)


def decode(path, sr=SR):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(sr), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def lowpass(x, hz, order=2):
    return sosfilt(butter(order, hz, "lowpass", fs=SR, output="sos"), x)


def highpass(x, hz, order=2):
    return sosfilt(butter(order, hz, "highpass", fs=SR, output="sos"), x)


def bandpass(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "bandpass", fs=SR, output="sos"), x)


def peak_to(x, db):
    p = np.abs(x).max()
    return x * (10 ** (db / 20) / p) if p > 0 else x


def fade(x, ins=0.0005, outs=0.02):
    x = x.copy()
    i, o = int(ins * SR), int(outs * SR)
    if i:
        x[:i] *= np.linspace(0, 1, i)
    if o:
        x[-o:] *= np.linspace(1, 0, o)
    return x


def trim_silence(x, thresh=0.01):
    idx = np.where(np.abs(x) > thresh * np.abs(x).max())[0]
    return x[idx[0] : idx[-1] + 1] if len(idx) else x


def write(out, name, x):
    x = np.clip(x, -1, 1)
    wavfile.write(os.path.join(out, f"{name}.wav"), SR, (x * 32767).astype(np.int16))


def tail(x, keep_after, tau, length):
    """Cuts to `length` seconds and lets everything after `keep_after` die away with time constant `tau`."""
    n = int(length * SR)
    x = x[:n].copy()
    t = np.arange(len(x)) / SR
    x *= np.where(t < keep_after, 1.0, np.exp(-(t - keep_after) / tau))
    return x


def punch(x, drive=2.2, thump=0.0, f0=95.0, f1=42.0, tau=0.1):
    """Squashes the spike so the body of the shot is heard, and lays a short low thump under it."""
    x = np.tanh(drive * x / max(np.abs(x).max(), 1e-9)) / np.tanh(drive)
    if thump > 0:
        n = int(0.45 * SR)
        t = np.arange(n) / SR
        phase = 2 * np.pi * (f1 * t + (f0 - f1) * tau * (1 - np.exp(-t / tau)))
        low = np.sin(phase) * np.exp(-t / tau) * np.minimum(t / 0.002, 1) * thump
        x = x.copy()
        m = min(len(x), n)
        x[:m] += low[:m]
    return x


def onsets(x, rel=0.2, refractory=0.35):
    env = np.convolve(np.abs(x), np.ones(int(SR * 0.003)) / int(SR * 0.003), "same")
    peak = env.max()
    out, i = [], 0
    while i < len(env):
        if env[i] > rel * peak:
            j = i
            while j > 0 and env[j] > 0.04 * env[i]:
                j -= 1
            out.append(j)
            i += int(refractory * SR)
        else:
            i += 1
    return out


def shots(path, pre=0.004, length=1.5):
    x = decode(path)
    return [x[max(0, s - int(pre * SR)) : s + int(length * SR)] for s in onsets(x)]


# ------------------------------------------------------------------ synth

def env_exp(n, tau):
    return np.exp(-np.arange(n) / SR / tau)


def tone(freq, dur, tau, harmonics=((1, 1.0),), delay=0.0, total=None):
    n = int((total if total is not None else dur + delay) * SR)
    x = np.zeros(n)
    s = int(delay * SR)
    m = min(int(dur * SR), n - s)
    t = np.arange(m) / SR
    sig = sum(a * np.sin(2 * np.pi * freq * h * t) for h, a in harmonics)
    x[s : s + m] = sig * env_exp(m, tau)
    return x


def saw(freq, t):
    return 2 * ((freq * t) % 1.0) - 1


def noise(n):
    return rng.standard_normal(n)


def synth_spotted():
    n = int(1.0 * SR)
    t = np.arange(n) / SR
    thump = np.sin(2 * np.pi * (45 + 40 * np.exp(-t / 0.12)) * t) * np.exp(-t / 0.28)
    crack = lowpass(noise(n), 2200) * np.exp(-t / 0.05)
    stab = lowpass(saw(311, t) + saw(330, t) + 0.7 * saw(466, t), 2400) * np.exp(-t / 0.3) * 0.35
    return peak_to(fade(thump * 1.2 + crack * 0.7 + stab, 0.0005, 0.06), -2)


def synth_body():
    n = int(1.6 * SR)
    t = np.arange(n) / SR
    swell = np.minimum(t / 0.35, 1) * np.exp(-np.maximum(t - 0.35, 0) / 0.55)
    pad = (np.sin(2 * np.pi * 98 * t) + np.sin(2 * np.pi * 103 * t) + 0.5 * np.sin(2 * np.pi * 207 * t)) * swell
    tick = highpass(noise(n), 1500) * np.exp(-t / 0.012) * 0.6
    return peak_to(fade(pad * 0.5 + tick, 0.0005, 0.12), -4)


def synth_dead():
    n = int(2.0 * SR)
    t = np.arange(n) / SR
    drop = np.sin(2 * np.pi * np.cumsum(220 * np.exp(-t / 0.5) + 40) / SR) * np.exp(-t / 0.7)
    thump = np.sin(2 * np.pi * 50 * t) * np.exp(-t / 0.25)
    rumble = lowpass(noise(n), 300) * np.exp(-t / 0.6) * 0.6
    return peak_to(fade(drop * 0.6 + thump + rumble, 0.0005, 0.2), -3)


def synth_escaped():
    notes = [523.25, 659.25, 783.99, 1046.5]
    n = int(1.9 * SR)
    x = np.zeros(n)
    for i, f in enumerate(notes):
        x += tone(f, 1.6, 0.5, ((1, 1.0), (2, 0.35), (3, 0.12)), delay=i * 0.09, total=1.9) * (0.7 + 0.1 * i)
    shimmer = highpass(noise(n), 5000) * np.exp(-np.arange(n) / SR / 0.25) * 0.05
    return peak_to(fade(x + shimmer, 0.0005, 0.15), -3)


def synth_radio(static):
    n = int(0.55 * SR)
    t = np.arange(n) / SR
    s = bandpass(static[SR : SR + n], 700, 3200)
    s *= 0.5 * (0.6 + 0.4 * np.sign(np.sin(2 * np.pi * 38 * t))) * np.minimum(t / 0.01, 1) * np.where(t < 0.5, 1, np.exp(-(t - 0.5) / 0.02))
    beep1 = tone(1400, 0.05, 1.0, total=0.55)
    beep2 = tone(1100, 0.05, 1.0, delay=0.46, total=0.55)
    return peak_to(fade(s + 0.8 * (beep1 + beep2), 0.0005, 0.02), -4)


def synth_empty():
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    return peak_to(fade(bandpass(noise(n), 1500, 6000) * np.exp(-t / 0.008) + 0.5 * np.sin(2 * np.pi * 1800 * t) * np.exp(-t / 0.01), 0.0002, 0.01), -8)


def synth_swap():
    n = int(0.2 * SR)
    x = np.zeros(n)
    for at, f in ((0.0, 1400), (0.075, 900)):
        s = int(at * SR)
        m = int(0.06 * SR)
        t = np.arange(m) / SR
        x[s : s + m] += bandpass(noise(m), f, f * 3) * np.exp(-t / 0.012) + 0.4 * np.sin(2 * np.pi * f * 0.7 * t) * np.exp(-t / 0.01)
    return peak_to(fade(x, 0.0002, 0.02), -7)


def synth_hide():
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    mod = 0.55 + 0.45 * np.abs(np.sin(2 * np.pi * 7 * t + 1.3)) * np.exp(-t / 0.4)
    x = bandpass(noise(n), 900, 2800) * mod * np.minimum(t / 0.05, 1) * np.exp(-t / 0.22)
    return peak_to(fade(x, 0.002, 0.08), -12)


# ------------------------------------------------------------------ build

def build_sfx(src, out):
    fire = os.path.join(src, "firearms", "Prepared SFX Library")
    kenney = os.path.join(src, "kenney")
    imp = os.path.join(kenney, "kenney-impact-sounds-for-godot", "addons", "kenney impact sounds")
    ui = os.path.join(kenney, "kenney-interface-sounds", "addons", "kenney_interface_sounds")
    oga = os.path.join(src, "oga")
    made = []

    def save(name, x):
        write(out, name, x)
        made.append(name)

    # Your guns. Quiet on purpose: a suppressed pistol is a dull thup, the SMG a bit sharper, the shotgun the loudest.
    ppq = shots(os.path.join(fire, "Walther PPQ", "X_39P.wav"))
    for i, s in enumerate(ppq[:3], 1):
        save(f"shot-pistol-{i}", peak_to(fade(tail(punch(lowpass(s, 2600), 2.2, 0.25), 0.05, 0.08, 0.5), 0.001, 0.06), -2))
    m45 = shots(os.path.join(fire, "Carl Gustav M45", "G_31P.wav"))
    for i, s in enumerate(m45[:3], 1):
        save(f"shot-smg-{i}", peak_to(fade(tail(punch(lowpass(s, 4200), 2.2, 0.35), 0.04, 0.07, 0.4), 0.001, 0.05), -2))
    nova = shots(os.path.join(fire, "Nova", "O_21P.wav"))
    for i, s in enumerate(nova[:2], 1):
        save(f"shot-shotgun-{i}", peak_to(fade(tail(punch(lowpass(s, 6500), 2.0, 0.5, 80, 38, 0.14), 0.12, 0.2, 1.0), 0.001, 0.1), -1))

    # Guards' guns: unsuppressed, so everyone in the building hears them.
    loud = shots(os.path.join(fire, "1911", "A_42P.wav")) + shots(os.path.join(fire, "1911", "A_34P.wav"))[:1]
    for i, s in enumerate(loud[:3], 1):
        save(f"shot-guard-{i}", peak_to(fade(tail(punch(s, 1.8, 0.4, 85, 40, 0.12), 0.15, 0.3, 1.4), 0.001, 0.1), -1))

    # Reloads and handling.
    reload_pistol = decode(os.path.join(oga, "reload.wav"))
    save("reload-pistol", peak_to(fade(trim_silence(reload_pistol), 0.001, 0.05), -4))
    save("reload-smg", peak_to(fade(trim_silence(decode(os.path.join(oga, "assaultreload.wav"))), 0.001, 0.05), -4))
    save("reload-shotgun", peak_to(fade(trim_silence(decode(os.path.join(oga, "sg", "ShotgunSounds", "Shell in Chamber.mp3"))), 0.001, 0.05), -4))
    save("shotgun-rack", peak_to(fade(trim_silence(decode(os.path.join(oga, "sg", "ShotgunSounds", "Rack.mp3"))), 0.001, 0.05), -5))
    save("empty-click", synth_empty())
    save("swap", synth_swap())
    save("hide", synth_hide())

    # Bodies, hits and ricochets from Kenney's impact set.
    def impact(name, n):
        return trim_silence(decode(os.path.join(imp, f"{name}_{n:03d}.ogg")))

    for i in range(2):
        save(f"hit-enemy-{i + 1}", peak_to(fade(impact("impact_punch_medium", i), 0.0005, 0.04), -4))
        save(f"hit-player-{i + 1}", peak_to(fade(impact("impact_punch_heavy", i), 0.0005, 0.05), -2))
        save(f"kill-{i + 1}", peak_to(fade(impact("impact_soft_heavy", i), 0.0005, 0.06), -3))
    for i in range(3):
        save(f"ricochet-{i + 1}", peak_to(fade(highpass(impact("impact_metal_light", i), 400), 0.0005, 0.05), -6))
    # Footsteps and loot sounds are made in code (scripts/stackstrike_foley.py); the Kenney footsteps were bright clicks.
    made += stackstrike_foley.build(out)

    # Alerts, loot and the ends of a run.
    static = decode(os.path.join(oga, "static1.wav"))
    save("spotted", synth_spotted())
    save("radio", synth_radio(static))
    save("body-found", synth_body())
    save("dead", synth_dead())
    save("escaped", synth_escaped())
    save("alarm", peak_to(fade(trim_silence(decode(os.path.join(oga, "alarm.ogg"))), 0.001, 0.05), -6))

    # Heartbeats, seamless loops: the less suspicious you are the slower the one you hear.
    save("heart-slow", peak_to(decode(os.path.join(oga, "heart_slow.wav")), -3))
    save("heart-fast", peak_to(decode(os.path.join(oga, "heart_fast.wav")), -3))

    # Menu feedback.
    save("ui-click", peak_to(trim_silence(decode(os.path.join(ui, "click_002.wav"))), -6))
    save("ui-confirm", peak_to(trim_silence(decode(os.path.join(ui, "confirmation_002.wav"))), -5))
    save("ui-back", peak_to(trim_silence(decode(os.path.join(ui, "back_002.wav"))), -6))
    return made


MUSIC = {
    # name: (source file, integrated loudness in LUFS). The hunted track is meant to feel louder.
    "music-stealth": ("music/electric1.flac", -25),
    "music-hunted": ("music/electric2.flac", -20),
}


def build_music(src, out):
    for name, (file, lufs) in MUSIC.items():
        subprocess.run(
            [
                "ffmpeg", "-v", "error", "-y", "-i", os.path.join(src, file),
                "-af", f"loudnorm=I={lufs}:TP=-2:LRA=9",
                "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "112k",
                os.path.join(out, f"{name}.mp3"),
            ],
            check=True,
        )
    return list(MUSIC)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", default="public/stackstrike/audio")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    sfx = build_sfx(args.src, args.out)
    music = build_music(args.src, args.out)
    with open(os.path.join(args.out, "manifest.json"), "w") as f:
        json.dump({"sfx": sorted(sfx), "music": sorted(music)}, f, indent=2)
    total = sum(os.path.getsize(os.path.join(args.out, n)) for n in os.listdir(args.out))
    print(f"{len(sfx)} sounds, {len(music)} tracks, {total / 1e6:.1f} MB")


main()
