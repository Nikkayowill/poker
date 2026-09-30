#!/usr/bin/env python3
"""The fishing sounds: the reel's two speeds, line running out on a cast, and the rod's swish.

Cut from real recordings on Freesound, all CC0 ("You can copy, modify, distribute and perform the
sound, even for commercial purposes, all without the need of asking permission to the author"),
checked on each page 2026-09-24:

    716634  Old fishing reel slow rewinding fishing line   AudioPapkin
    716635  Old fishing reel fast rewinding fishing line   AudioPapkin
    507099  Fly Fishing Reel Running_5.wav                 paulprit
    371313  Fishing Rod Swish Swoosh.wav                   Mrthenoronha

The loops are WAV, not MP3: an MP3 carries a few ms of encoder padding at each end, which clicks every
time a loop comes round. Each loop is a slice whose tail is crossfaded into its head, so it has no seam.

    python3 reel.py    # downloads the previews once into ~/.cache, writes public/audio/stackacres/sfx/
"""
import os
import subprocess
import urllib.request
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(REPO, "public", "audio", "stackacres", "sfx")
CACHE = os.path.expanduser("~/.cache/stackacres-audio")
RATE = 22050
# The farm's recordings are levelled to about -15 dBFS peak (lib/audio/stackacres-ambience.ts).
PEAK_DB = -15.0

SOURCES = {
    "slow": "https://cdn.freesound.org/previews/716/716634_8698658-hq.mp3",
    "fast": "https://cdn.freesound.org/previews/716/716635_8698658-hq.mp3",
    "line": "https://cdn.freesound.org/previews/507/507099_8682843-hq.mp3",
    "swish": "https://cdn.freesound.org/previews/371/371313_2402876-hq.mp3",
}

# Where each loop is cut from, in seconds, picked where the ratchet runs steady (its click rate holds
# through the slice) and the level does not dip.
LOOPS = {
    "reel-slow": ("slow", 5.0, 2.0),
    "reel-fast": ("fast", 0.5, 2.0),
    "line-out": ("line", 6.0, 1.6),
}
CROSSFADE_S = 0.08


def fetch(key):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, os.path.basename(SOURCES[key]))
    if not os.path.exists(path):
        urllib.request.urlretrieve(SOURCES[key], path)
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def level(x):
    return x * (10 ** (PEAK_DB / 20) / (np.abs(x).max() or 1))


def seamless(x, start, length):
    """`length` seconds from `start`, with the next CROSSFADE_S faded over its own head."""
    a, n, f = int(start * RATE), int(length * RATE), int(CROSSFADE_S * RATE)
    body = x[a:a + n].copy()
    tail = x[a + n:a + n + f]
    ramp = np.linspace(0, 1, f, dtype=np.float32)
    body[:f] = body[:f] * ramp + tail * (1 - ramp)
    return body


def write_wav(name, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    path = os.path.join(OUT, f"{name}.wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())
    return path


def swish(x):
    """The cleanest single swing: the loudest 20ms, and 0.2s before it to 0.35s after."""
    hop = int(0.02 * RATE)
    env = np.array([np.abs(x[i:i + hop]).max() for i in range(0, len(x) - hop, hop)])
    peak = int(env.argmax()) * hop
    one = x[max(0, peak - int(0.2 * RATE)):peak + int(0.35 * RATE)].copy()
    fade = int(0.06 * RATE)
    one[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)
    one[:int(0.01 * RATE)] *= np.linspace(0, 1, int(0.01 * RATE), dtype=np.float32)
    return one


def main():
    os.makedirs(OUT, exist_ok=True)
    sources = {key: fetch(key) for key in SOURCES}
    for name, (key, start, length) in LOOPS.items():
        path = write_wav(name, level(seamless(sources[key], start, length)))
        print("wrote", os.path.relpath(path, REPO))
    tmp = write_wav("rod-swish", level(swish(sources["swish"])))
    mp3 = tmp[:-4] + ".mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", tmp, "-codec:a", "libmp3lame", "-q:a", "4", mp3], check=True)
    os.remove(tmp)
    print("wrote", os.path.relpath(mp3, REPO))


if __name__ == "__main__":
    main()
