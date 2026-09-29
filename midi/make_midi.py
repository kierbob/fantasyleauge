"""Generate dreamy_piano_sketch.mid: an original 8-bar A-minor piano loop, 70 BPM, 4/4."""
import random
import struct
import sys

PPQ = 480
BPM = 70
BAR = 4  # beats per bar
TOTAL_BEATS = 8 * BAR
random.seed(7)

# ---- Left hand: (bar, beat_onset, pitch, velocity, end_beat_in_bar) ----
# Broken-chord voicings, each note held to bar end (sustain feel even without pedal).
LH_VOICINGS = [
    # bar, [(onset, pitch)], label
    (0, [(0.0, 45), (0.5, 52), (1.0, 59), (2.5, 60)]),              # Am(add9): A2 E3 B3 C4
    (1, [(0.0, 41), (0.5, 48), (1.0, 52), (2.5, 57)]),              # Fmaj7:    F2 C3 E3 A3
    (2, [(0.0, 36), (0.5, 43), (1.0, 52), (2.5, 59)]),              # Cmaj7:    C2 G2 E3 B3
    (3, [(0.0, 43), (0.5, 50), (1.0, 57), (2.5, 62)]),              # G6/9(no3):G2 D3 A3 D4
    (4, [(0.0, 45), (0.5, 52), (1.0, 59), (2.5, 60)]),              # Am(add9)
    (5, [(0.0, 41), (0.5, 48), (1.0, 52), (2.0, 57), (3.0, 59)]),   # Fmaj7#11: F2 C3 E3 A3 B3
    (6, [(0.0, 38), (0.5, 45), (1.0, 53), (2.5, 60), (3.0, 64)]),   # Dm9:      D2 A2 F3 C4 E4
]

lh = []
for bar, notes in LH_VOICINGS:
    for i, (onset, pitch) in enumerate(notes):
        vel = (54 if i == 0 else 42) + random.randint(-5, 5)
        lh.append((bar * BAR + onset, pitch, vel, bar * BAR + BAR))

# Bar 8: Esus4 -> Em7, left hanging so it falls back into Am at bar 1.
b8 = 7 * BAR
lh += [
    (b8 + 0.0, 40, 52, b8 + 4),   # E2
    (b8 + 0.5, 47, 41, b8 + 4),   # B2
    (b8 + 1.0, 57, 39, b8 + 2),   # A3 (sus4)
    (b8 + 2.0, 55, 40, b8 + 4),   # G3 (resolves sus -> minor third)
    (b8 + 3.0, 62, 36, b8 + 4),   # D4 (b7)
]

# ---- Right hand melody: (bar, onset, pitch, dur, vel) ----
MELODY = [
    # Phrase A (bars 1-4)
    (0, 1.0, 76, 0.75, 62), (0, 1.75, 74, 0.25, 52), (0, 2.0, 76, 0.5, 58), (0, 2.5, 79, 1.5, 66),
    (1, 1.5, 76, 0.5, 56), (1, 2.0, 72, 2.0, 60),
    (2, 1.0, 71, 0.5, 54), (2, 1.5, 72, 0.5, 58), (2, 2.0, 74, 0.5, 62), (2, 2.5, 76, 1.5, 68),
    (3, 1.0, 74, 2.5, 60),
    (3, 3.0, 88, 1.0, 30),   # faint high E6 shimmer
    # Phrase A' (bars 5-8): same opening gesture, reaches higher, then sinks
    (4, 1.0, 76, 0.75, 64), (4, 1.75, 74, 0.25, 53), (4, 2.0, 76, 0.5, 60), (4, 2.5, 83, 1.0, 72), (4, 3.5, 81, 0.5, 58),
    (5, 1.0, 79, 0.75, 62), (5, 1.75, 76, 0.25, 50), (5, 2.0, 71, 2.0, 55),
    (6, 1.0, 72, 0.5, 56), (6, 1.5, 74, 0.5, 60), (6, 2.0, 77, 0.5, 66), (6, 2.5, 76, 1.5, 61),
    (7, 1.0, 74, 1.0, 54), (7, 2.0, 71, 2.0, 47),   # ends on B4: unresolved
    (7, 3.0, 83, 1.0, 26),   # faint high B5 echo
]

rh = []
for bar, onset, pitch, dur, vel in MELODY:
    start = bar * BAR + onset
    rh.append((start, pitch, vel + random.randint(-3, 3), start + dur))


def to_tick(beat):
    return int(round(beat * PPQ))


def humanize(start, end, max_shift=12):
    """Nudge onsets slightly; keep loop boundaries (tick 0 and the end) exact."""
    s, e = to_tick(start), to_tick(end)
    if s % (PPQ * BAR) != 0:  # leave downbeats of each bar alone
        s += random.randint(-max_shift, max_shift)
    e = min(e - 6, to_tick(TOTAL_BEATS))  # tiny gap so repeated notes re-trigger cleanly
    return max(0, s), e


events = []  # (tick, order, bytes)  order: note-offs before note-ons at same tick
for start, pitch, vel, end in lh + rh:
    s, e = humanize(start, end)
    vel = max(1, min(127, vel))
    events.append((s, 1, bytes([0x90, pitch, vel])))
    events.append((e, 0, bytes([0x80, pitch, 0])))

# Sustain pedal: re-pedal just after each bar line, lift just before the next.
for bar in range(8):
    events.append((to_tick(bar * BAR) + 20, 2, bytes([0xB0, 64, 100])))
    events.append((to_tick((bar + 1) * BAR) - 10, 0, bytes([0xB0, 64, 0])))


def vlq(n):
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    return bytes(reversed(out))


def track(chunks):
    data = b"".join(chunks)
    return b"MTrk" + struct.pack(">I", len(data)) + data


def meta(t, payload):
    return b"\xff" + bytes([t]) + vlq(len(payload)) + payload


end_tick = to_tick(TOTAL_BEATS)
mpqn = int(60_000_000 / BPM)

conductor = track([
    vlq(0), meta(0x03, b"Dreamy Piano Sketch"),
    vlq(0), meta(0x58, bytes([4, 2, 24, 8])),           # 4/4
    vlq(0), meta(0x51, mpqn.to_bytes(3, "big")),        # 70 BPM
    vlq(0), meta(0x59, bytes([0, 1])),                  # A minor
    vlq(end_tick), meta(0x2F, b""),
])

piano = [vlq(0), meta(0x03, b"Acoustic Grand Piano"),
         vlq(0), bytes([0xC0, 0])]                      # program 0 = Acoustic Grand Piano
now = 0
for tick, _, msg in sorted(events, key=lambda x: (x[0], x[1])):
    piano += [vlq(tick - now), msg]
    now = tick
piano += [vlq(end_tick - now), meta(0x2F, b"")]

header = b"MThd" + struct.pack(">IHHH", 6, 1, 2, PPQ)
out = sys.argv[1]
with open(out, "wb") as f:
    f.write(header + conductor + track(piano))
print(f"wrote {out}: {len(lh)} LH notes, {len(rh)} RH notes, {end_tick} ticks")
