"""Footsteps and loot pickups for StackStrike, made in code. Needs only numpy.

Run: python3 scripts/stackstrike_foley.py   (rewrites step-*, pickup-* in public/stackstrike/audio)

Why these exist: the first footsteps were short bright clicks (most of the energy near 3 kHz, two takes
were byte-identical) and the gold case was a shrill sine arpeggio with white-noise clinks (a third of its
energy above 4 kHz). These are lower and rounder: a footfall is a soft thump with a little scuff on top, a
pickup is a warm bell with a quiet coin clink. Deterministic.
"""
import os
import wave

import numpy as np

SR = 44100
OUT = "public/stackstrike/audio"
STEP_TAKES = 4


def t_axis(seconds):
    return np.arange(int(seconds * SR)) / SR


def smooth_filter(x, lo=None, hi=None):
    """Band-limits with a gentle FFT slope: `lo` high-passes, `hi` low-passes, either may be None."""
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    gain = np.ones_like(f)
    if hi is not None:
        gain *= 1 / (1 + (f / hi) ** 4)
    if lo is not None:
        gain *= 1 - 1 / (1 + (f / lo) ** 4)
    return np.fft.irfft(spec * gain, len(x))


def env(n, attack, tau):
    t = np.arange(n) / SR
    rise = np.minimum(1.0, t / max(attack, 1e-5))
    return (0.5 - 0.5 * np.cos(np.pi * rise)) * np.exp(-t / tau)


def thump(seconds, f_start, f_end, tau, attack=0.004):
    """A sine that drops in pitch, the body of a footfall."""
    t = t_axis(seconds)
    f = f_end + (f_start - f_end) * np.exp(-t / 0.03)
    phase = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(phase) * env(len(t), attack, tau)


def noise_burst(rng, seconds, lo, hi, tau, attack=0.003):
    n = int(seconds * SR)
    return smooth_filter(rng.standard_normal(n), lo, hi) * env(n, attack, tau)


def place(into, part, at):
    start = int(at * SR)
    end = min(len(into), start + len(part))
    into[start:end] += part[: end - start]


def finish(x, peak_db, fade_out=0.04):
    n = int(fade_out * SR)
    x = x.copy()
    x[-n:] *= np.linspace(1, 0, n)
    return x * (10 ** (peak_db / 20) / np.abs(x).max())


def step_soft(rng, i):
    """The player's step: a soft sole on a floor. Body around 200 Hz so a phone speaker can play it, a soft scuff, over in a tenth of a second."""
    n = int(0.16 * SR)
    x = np.zeros(n)
    body = 190 + 20 * i + rng.uniform(-8, 8)
    place(x, thump(0.14, body * 1.25, body * 0.75, 0.03), 0)
    place(x, 0.5 * noise_burst(rng, 0.12, 250, 2200, 0.026, 0.006), 0.004)
    return finish(x, -9)


def step_boot(rng, i):
    """A guard's step: heel, then a smaller toe a moment later, a knock of hard sole on top."""
    n = int(0.24 * SR)
    x = np.zeros(n)
    heel = 150 + 12 * i + rng.uniform(-6, 6)
    place(x, thump(0.18, heel * 1.5, heel * 0.55, 0.04), 0)
    place(x, 0.30 * np.sin(2 * np.pi * (380 + 40 * i) * t_axis(0.05)) * env(int(0.05 * SR), 0.002, 0.012), 0.001)
    place(x, 0.42 * noise_burst(rng, 0.05, 300, 2600, 0.009, 0.002), 0)
    place(x, 0.40 * thump(0.1, heel * 1.2, heel * 0.7, 0.025), 0.07 + rng.uniform(0, 0.012))
    place(x, 0.16 * noise_burst(rng, 0.04, 400, 2000, 0.008, 0.002), 0.07)
    return finish(x, -6)


def bell(freq, seconds, tau, delay=0.0, total=None, amp=1.0):
    """A soft struck bell: the note, its octave and a quick inharmonic partial that gives it a metal edge."""
    n = int((total if total is not None else seconds + delay) * SR)
    x = np.zeros(n)
    m = int(seconds * SR)
    t = np.arange(m) / SR
    partials = ((1.0, 1.0, 1.0), (2.0, 0.28, 0.6), (3.0, 0.07, 0.35), (2.76, 0.12, 0.2))
    sig = sum(a * np.sin(2 * np.pi * freq * r * t) * np.exp(-t / (tau * d)) for r, a, d in partials)
    sig *= np.minimum(1.0, t / 0.004)
    start = int(delay * SR)
    x[start : start + m] += sig[: n - start] * amp if start + m > n else sig * amp
    return x


def clink(rng, seconds, freq, tau, amp):
    """One coin touching another: a short ringing tick."""
    t = t_axis(seconds)
    ring = np.sin(2 * np.pi * freq * t) + 0.5 * np.sin(2 * np.pi * freq * 1.47 * t)
    return amp * (ring * env(len(t), 0.0006, tau) + 0.4 * smooth_filter(rng.standard_normal(len(t)), 2500, 6000) * env(len(t), 0.0004, tau * 0.4))


def pickup_small(rng):
    """A small valuable: two soft notes rising, a faint clink."""
    n = int(0.55 * SR)
    x = bell(783.99, 0.45, 0.11, 0.0, 0.55) + bell(1046.5, 0.45, 0.13, 0.075, 0.55, 0.9)
    place(x, clink(rng, 0.08, 3300, 0.012, 0.16), 0.0)
    x = smooth_filter(x, 120, 5200)
    return finish(x[:n], -6, 0.08)


def pickup_main(rng):
    """The gold case: a heavy thud as it comes up, a rising chord of soft bells, a little spill of coins, a long warm tail."""
    n = int(1.5 * SR)
    x = np.zeros(n)
    place(x, 0.55 * thump(0.16, 130, 55, 0.05, 0.003), 0)
    for k, f in enumerate([523.25, 659.25, 783.99, 1046.5]):
        x += bell(f, 1.1, 0.34, 0.09 + k * 0.085, 1.5, 0.75)
    x += bell(1318.5, 1.2, 0.5, 0.09 + 4 * 0.085, 1.5, 0.55)
    for k in range(7):
        place(x, clink(rng, 0.09, rng.uniform(2800, 4300), 0.014, 0.1 + 0.05 * rng.random()), 0.34 + k * 0.05 + rng.uniform(0, 0.02))
    x = smooth_filter(x, 70, 5200)
    return finish(x, -4, 0.2)


def write_wav(name, x, out=OUT):
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    with wave.open(os.path.join(out, f"{name}.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def build(out=OUT):
    """Writes the files and returns their names."""
    rng = np.random.default_rng(11)
    names = []
    for i in range(STEP_TAKES):
        write_wav(f"step-soft-{i + 1}", step_soft(rng, i), out)
        write_wav(f"step-boot-{i + 1}", step_boot(rng, i), out)
        names += [f"step-soft-{i + 1}", f"step-boot-{i + 1}"]
    write_wav("pickup-small", pickup_small(rng), out)
    write_wav("pickup-main", pickup_main(rng), out)
    return names + ["pickup-small", "pickup-main"]


if __name__ == "__main__":
    print("\n".join(build()))
