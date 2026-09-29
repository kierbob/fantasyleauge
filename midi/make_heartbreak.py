"""Generate heartbreak_piano.mid: original 20-bar sad piece, C# minor, 60 BPM, 4/4 with a triplet feel.

Written to sit under a heartbreaking scene: very soft, sparse, legato piano; a quiet string bed;
a cello lament line; one restrained swell; an unresolved fade-out. No drums.

Bars 1-4   intro   piano alone, almost nothing
Bars 5-12  theme   piano melody, strings enter underneath
Bars 13-16 swell   melody rises, cello descends, strings open up (still soft)
Bars 17-20 fade    fragments of the theme, slowing, ends hanging on Amaj7
"""
import random
import struct
import sys

PPQ = 480
E = PPQ // 3           # triplet eighth
BAR = 12
N_BARS = 20
random.seed(5)

PIANO, STRINGS, CELLO = 0, 1, 2
notes = []             # (ch, start_tick, end_tick, pitch, vel)


def add(ch, start_e, dur_e, pitch, vel, legato=0, human=True):
    s = start_e * E
    if human and start_e % BAR:
        s += random.randint(-10, 10)
    e = (start_e + dur_e) * E + legato - 8
    notes.append((ch, max(0, s), e, pitch, max(1, min(127, int(vel)))))


V = {
    "C#m9":   [37, 44, 51, 52],   # C# G# D# E
    "Amaj7":  [33, 40, 52, 56],   # A E E G#
    "G#sus":  [44, 51, 56, 61],
    "G#":     [44, 51, 56, 60],
    "C#m":    [37, 44, 52, 56],
    "E":      [40, 47, 56, 59],
    "B/D#":   [39, 47, 54, 59],
    "F#m9":   [42, 49, 56, 57],   # F# C# G# A
    "D":      [38, 45, 54, 57],   # Neapolitan
    "A":      [33, 45, 52, 57],
    "E/G#":   [44, 52, 56, 59],
    "Dadd9":  [38, 45, 52, 54],
}
PATTERN = [(0, 0), (2, 1), (4, 2), (8, 3)]   # 4 notes a bar, spread out, all left ringing


def left_hand(bar, chord, vel, first_half_only=False, low_octave=False):
    for e, idx in PATTERN:
        if first_half_only and e >= 6:
            continue
        end = 6 if first_half_only else BAR
        add(PIANO, bar * BAR + e, end - e, V[chord][idx],
            vel + (4 if idx == 0 else 0) + random.randint(-2, 2))
    if low_octave:
        add(PIANO, bar * BAR, BAR, V[chord][0] - 12, vel - 4)


def melody(bar, phrase, vel, double=False):
    for i, (e, pitch, dur) in enumerate(phrase):
        # notes lean in on longer values and fall away at phrase ends
        v = vel + (3 if dur >= 6 else 0) - (4 if i == len(phrase) - 1 else 0) + random.randint(-2, 2)
        add(PIANO, bar * BAR + e, dur, pitch, v, legato=90)
        if double:
            add(PIANO, bar * BAR + e, dur, pitch - 12, v * 0.6, legato=90)


def pad(bar, pitches, vel, bars=1):
    for j, p in enumerate(pitches):
        add(STRINGS, bar * BAR, BAR * bars, p, vel - j * 2, human=False)


# ---------------- intro (bars 1-4) ----------------
INTRO = [("C#m9", [(6, 68, 6)]),
         ("Amaj7", [(3, 73, 3), (6, 71, 6)]),
         ("C#m9", [(6, 68, 6)]),
         ("G#sus", [(0, 73, 12)])]
for bar, (ch, mel) in enumerate(INTRO):
    left_hand(bar, ch, 15)
    melody(bar, mel, 27)

# ---------------- theme (bars 5-12) ----------------
THEME_CHORDS = ["C#m", "Amaj7", "E", "B/D#", "C#m", "F#m9", "D", "G#sus"]
THEME = [
    [(3, 68, 3), (6, 73, 4), (10, 71, 2)],
    [(0, 76, 5), (5, 75, 1), (6, 73, 6)],
    [(0, 71, 3), (3, 68, 3), (9, 71, 3)],
    [(0, 69, 9)],
    [(3, 68, 3), (6, 73, 3), (9, 76, 3)],
    [(0, 80, 5), (5, 78, 1), (6, 76, 6)],
    [(0, 78, 3), (3, 74, 3), (6, 69, 6)],
    [(0, 73, 6), (6, 72, 6)],
]
THEME_PAD = [[56, 64, 68], [56, 61, 64], [56, 59, 64], [54, 59, 63],
             [56, 64, 68], [57, 61, 68], [54, 57, 62], [56, 61, 63]]
for i in range(8):
    bar = 4 + i
    if i == 7:
        left_hand(bar, "G#sus", 19, first_half_only=True)
        for e, idx in [(6, 0), (8, 1), (10, 3)]:
            add(PIANO, bar * BAR + e, BAR - e, V["G#"][idx], 19)
    else:
        left_hand(bar, THEME_CHORDS[i], 19)
    melody(bar, THEME[i], 34)
    pad(bar, THEME_PAD[i], 22 + (i // 2))
for i, p in enumerate([49, 45, 52, 51, 49, 42, 50, 44]):     # cello enters bar 9, very low
    if i >= 4:
        add(CELLO, (4 + i) * BAR, BAR, p, 30)

# ---------------- swell (bars 13-16) ----------------
SWELL_CHORDS = ["A", "E/G#", "F#m9", "Dadd9"]
SWELL = [
    [(0, 80, 6), (6, 81, 3), (9, 80, 3)],
    [(0, 76, 6), (6, 83, 6)],
    [(0, 81, 3), (3, 80, 3), (6, 78, 6)],
    [(0, 76, 6), (6, 74, 3), (9, 73, 3)],
]
SWELL_PAD = [[57, 64, 69, 73], [56, 64, 68, 71], [57, 61, 64, 68], [57, 62, 66, 69]]
for i in range(4):
    bar = 12 + i
    left_hand(bar, SWELL_CHORDS[i], 24, low_octave=True)
    melody(bar, SWELL[i], 44 + (2 if i < 2 else -2), double=True)
    pad(bar, SWELL_PAD[i], 34 + (4 if i in (1, 2) else 0))
for i, p in enumerate([57, 56, 54, 50]):                      # cello lament: A G# F# D
    add(CELLO, (12 + i) * BAR, BAR, p, 42 + (3 if i in (1, 2) else 0))

# ---------------- fade (bars 17-20) ----------------
FADE = [("C#m9", [(3, 68, 3), (6, 73, 6)]),
        ("Amaj7", [(0, 71, 6), (6, 68, 6)]),
        ("F#m9", [(6, 69, 6)]),
        ("Amaj7", [(0, 68, 12)])]
FADE_PAD = [[56, 63, 64], [56, 61, 64], [57, 61, 64], [56, 61, 64]]
for i, (ch, mel) in enumerate(FADE):
    bar = 16 + i
    left_hand(bar, ch, 18 - i * 2)
    melody(bar, mel, 30 - i * 3)
    pad(bar, FADE_PAD[i], 26 - i * 3)
for i, p in enumerate([49, 45, 42, 45]):
    add(CELLO, (16 + i) * BAR, BAR, p, 32 - i * 4)

# ---------------- write ----------------
END = N_BARS * BAR * E


def vlq(n):
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    return bytes(reversed(out))


def meta(t, payload):
    return b"\xff" + bytes([t]) + vlq(len(payload)) + payload


def track(name, events, program, ch):
    chunks = [vlq(0), meta(0x03, name.encode()), vlq(0), bytes([0xC0 | ch, program])]
    now = 0
    for t, _, msg in sorted(events, key=lambda x: (x[0], x[1])):
        chunks += [vlq(t - now), msg]
        now = t
    chunks += [vlq(END - now), meta(0x2F, b"")]
    data = b"".join(chunks)
    return b"MTrk" + struct.pack(">I", len(data)) + data


per = {PIANO: [], STRINGS: [], CELLO: []}
for ch, s, e, p, v in notes:
    e = min(e, END)
    per[ch].append((s, 1, bytes([0x90 | ch, p, v])))
    per[ch].append((e, 0, bytes([0x80 | ch, p, 0])))

# pedals: sustain every bar (half bars in bar 12 for the sus -> G# change), soft pedal throughout
for bar in range(N_BARS):
    cuts = [0, 6] if bar == 11 else [0]
    for k, c in enumerate(cuts):
        nxt = cuts[k + 1] if k + 1 < len(cuts) else BAR
        per[PIANO].append(((bar * BAR + c) * E + 30, 2, bytes([0xB0, 64, 110])))
        per[PIANO].append(((bar * BAR + nxt) * E - 15, 0, bytes([0xB0, 64, 0])))
per[PIANO].append((0, 0, bytes([0xB0, 67, 127])))
for ch in (PIANO, STRINGS, CELLO):
    per[ch].append((0, 0, bytes([0xB0 | ch, 91, 90])))        # reverb send
per[STRINGS].append((0, 0, bytes([0xB0 | STRINGS, 7, 80])))
per[CELLO].append((0, 0, bytes([0xB0 | CELLO, 7, 85])))


def tempo(bpm):
    return meta(0x51, int(60_000_000 / bpm).to_bytes(3, "big"))


# 60 BPM, easing back over the last two bars
tempo_map = [(0, 60), (18 * BAR * E, 57), (19 * BAR * E, 53), (19 * BAR * E + 6 * E, 48)]
cond = [vlq(0), meta(0x03, b"Heartbreak Piano"), vlq(0), meta(0x58, bytes([4, 2, 24, 8])),
        vlq(0), meta(0x59, bytes([4, 1]))]
now = 0
for t, bpm in tempo_map:
    cond += [vlq(t - now), tempo(bpm)]
    now = t
cond += [vlq(END - now), meta(0x2F, b"")]
cond = b"".join(cond)

tracks = [
    b"MTrk" + struct.pack(">I", len(cond)) + cond,
    track("Soft Piano", per[PIANO], 0, PIANO),
    track("Strings", per[STRINGS], 49, STRINGS),     # String Ensemble 2 (slow attack)
    track("Cello", per[CELLO], 42, CELLO),
]
out = sys.argv[1] if len(sys.argv) > 1 else "heartbreak_piano.mid"
with open(out, "wb") as f:
    f.write(b"MThd" + struct.pack(">IHHH", 6, 1, len(tracks), PPQ) + b"".join(tracks))
print(f"wrote {out}: {len(notes)} notes, {N_BARS} bars")
