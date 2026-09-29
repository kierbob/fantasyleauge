"""Generate soft_sea_mood.mid: original 18-bar piece, Ab major, 65 BPM, 4/4 triplet feel (~1:06).

Emotional tricks (techniques, not borrowed notes):
  - major key that sounds sad: tender Ab major undercut by the borrowed minor iv (Dbm, with Fb)
  - slow "wave" left hand: triplet ripples rising and falling, very quiet, pedal-blurred
  - melody sighs downward, lots of space, and ends on the 9th (never fully resolves)
  - one lift (bars 11-14) where melody climbs and strings open, then it sinks back

Bars 1-2   intro  ripples only
Bars 3-10  theme
Bars 11-14 lift
Bars 15-18 ending, slowing, hangs on Abmaj9
"""
import random
import struct
import sys

PPQ = 480
E = PPQ // 3
BAR = 12
N_BARS = 18
random.seed(9)

PIANO, STRINGS = 0, 1
notes = []


def add(ch, start_e, dur_e, pitch, vel, legato=0, human=True):
    s = start_e * E
    if human and start_e % BAR:
        s += random.randint(-10, 10)
    notes.append((ch, max(0, s), (start_e + dur_e) * E + legato - 8, pitch, max(1, min(127, int(vel)))))


V = {  # root, fifth, ninth, third (upper)
    "Abmaj9": [44, 51, 58, 60],
    "Fm7":    [41, 48, 55, 56],
    "Dbmaj7": [37, 44, 51, 53],
    "Ebsus":  [39, 46, 53, 56],
    "Eb":     [39, 46, 53, 55],
    "Ab/C":   [36, 44, 51, 58],
    "Dbm6":   [37, 44, 51, 52],   # borrowed minor iv: the Fb is the heartbreak note
    "Bbm7":   [34, 41, 48, 49],
    "Cm7":    [36, 43, 50, 51],
    "Fm9":    [41, 48, 55, 56],
    "Ab/Eb":  [39, 44, 51, 60],
}
WAVE = [(0, 0, 12), (1, 1, 5), (2, 2, 4), (4, 3, 8), (7, 2, 5), (9, 1, 3)]


def wave(bar, chord, vel, low=False, muffled=False, avoid=()):
    for e, idx, dur in WAVE:
        if V[chord][idx] in avoid:
            continue                     # the (lowered) melody already holds this key
        if muffled and idx == 3:
            continue                     # drop the bright upper note: "underwater"
        add(PIANO, bar * BAR + e, dur, V[chord][idx], vel + (4 if idx == 0 else 0) - (2 if e > 6 else 0)
            + random.randint(-2, 2))
    if low:
        add(PIANO, bar * BAR, BAR, V[chord][0] - 12, vel - 5)


def melody(bar, phrase, vel, double=False, octave=0):
    for i, (e, pitch, dur) in enumerate(phrase):
        pitch += octave
        v = vel + (3 if dur >= 6 else 0) - (4 if i == len(phrase) - 1 else 0) + random.randint(-2, 2)
        add(PIANO, bar * BAR + e, dur, pitch, v, legato=90)
        if double:
            add(PIANO, bar * BAR + e, dur, pitch - 12, v * 0.55, legato=90)


def pad(bar, pitches, vel):
    for j, p in enumerate(pitches):
        add(STRINGS, bar * BAR, BAR, p, vel - j * 2, human=False)


SECTIONS = [
    # (chord, melody, piano melody vel, wave vel, pad pitches, pad vel, lift?)
    ("Abmaj9", [], 0, 16, None, 0, False),
    ("Dbmaj7", [], 0, 16, None, 0, False),
    # theme
    ("Abmaj9", [(3, 72, 3), (6, 75, 6)], 32, 18, [56, 63, 67], 20, False),
    ("Fm7",    [(0, 80, 4), (4, 79, 2), (6, 75, 6)], 34, 18, [56, 60, 63], 21, False),
    ("Dbmaj7", [(0, 77, 6), (6, 72, 3), (9, 73, 3)], 34, 18, [56, 60, 65], 22, False),
    ("Ebsus",  [(0, 70, 9)], 31, 18, [55, 58, 63], 22, False),
    ("Ab/C",   [(3, 72, 3), (6, 75, 3), (9, 82, 3)], 35, 19, [56, 63, 67], 23, False),
    ("Dbm6",   [(0, 80, 6), (6, 76, 6)], 36, 19, [56, 61, 64], 25, False),
    ("Bbm7",   [(0, 77, 3), (3, 73, 3), (6, 72, 6)], 33, 18, [53, 60, 61], 24, False),
    ("Ebsus",  [(0, 70, 12)], 29, 17, [55, 58, 63], 22, False),
    # lift
    ("Dbmaj7", [(0, 84, 6), (6, 80, 3), (9, 82, 3)], 44, 22, [56, 60, 65, 68], 32, True),
    ("Cm7",    [(0, 79, 6), (6, 75, 6)], 45, 23, [55, 58, 63, 67], 36, True),
    ("Fm9",    [(0, 80, 3), (3, 79, 3), (6, 77, 6)], 42, 22, [56, 60, 63, 67], 34, True),
    ("Dbm6",   [(0, 76, 6), (6, 75, 6)], 38, 20, [56, 61, 64, 68], 30, True),
    # ending
    ("Ab/Eb",  [(3, 72, 3), (6, 75, 6)], 30, 17, [56, 60, 63], 24, False),
    ("Dbmaj7", [(0, 77, 6), (6, 72, 6)], 28, 16, [56, 60, 65], 21, False),
    ("Dbm6",   [(6, 76, 6)], 25, 15, [56, 61, 64], 18, False),
    ("Abmaj9", [(0, 70, 12)], 22, 13, [56, 60, 63], 14, False),
]
# Filter-free "underwater" trick written into the notes: bars 1-2 and 17-18 lose their bright
# upper notes and play quieter; the last two melody phrases sink an octave (surface -> sink back).
MUFFLED = {0: 0.7, 1: 0.8, 16: 0.85, 17: 0.75}
for bar, (chord, mel, mv, wv, padp, pv, lift) in enumerate(SECTIONS):
    muffled = bar in MUFFLED
    octave = -12 if bar >= 16 else 0
    wave(bar, chord, int(wv * MUFFLED.get(bar, 1)), low=lift, muffled=muffled,
         avoid={p + octave for _, p, _ in mel})
    if mel:
        melody(bar, mel, mv, double=lift, octave=octave)
    if padp:
        pad(bar, padp, pv)

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


per = {PIANO: [], STRINGS: []}
for ch, s, e, p, v in notes:
    per[ch].append((s, 1, bytes([0x90 | ch, p, v])))
    per[ch].append((min(e, END), 0, bytes([0x80 | ch, p, 0])))
for bar in range(N_BARS):
    per[PIANO].append((bar * BAR * E + 30, 2, bytes([0xB0, 64, 110])))
    per[PIANO].append(((bar + 1) * BAR * E - 15, 0, bytes([0xB0, 64, 0])))
per[PIANO] += [(0, 0, bytes([0xB0, 67, 127])), (0, 0, bytes([0xB0, 91, 90]))]
per[STRINGS] += [(0, 0, bytes([0xB0 | STRINGS, 91, 90])), (0, 0, bytes([0xB0 | STRINGS, 7, 80]))]

tempo_map = [(0, 65), (16 * BAR * E, 62), (17 * BAR * E, 56)]
cond = [vlq(0), meta(0x03, b"Soft Sea Mood"), vlq(0), meta(0x58, bytes([4, 2, 24, 8])),
        vlq(0), meta(0x59, bytes([0xFC, 0]))]          # Ab major (4 flats)
now = 0
for t, bpm in tempo_map:
    cond += [vlq(t - now), meta(0x51, int(60_000_000 / bpm).to_bytes(3, "big"))]
    now = t
cond += [vlq(END - now), meta(0x2F, b"")]
cond = b"".join(cond)

tracks = [b"MTrk" + struct.pack(">I", len(cond)) + cond,
          track("Soft Piano", per[PIANO], 0, PIANO),
          track("Strings", per[STRINGS], 49, STRINGS)]
out = sys.argv[1] if len(sys.argv) > 1 else "soft_sea_mood.mid"
with open(out, "wb") as f:
    f.write(b"MThd" + struct.pack(">IHHH", 6, 1, len(tracks), PPQ) + b"".join(tracks))
print(f"wrote {out}: {len(notes)} notes, {N_BARS} bars")
