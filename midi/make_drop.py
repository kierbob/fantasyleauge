"""Generate dreamy_piano_drop.mid: original 20-bar track in A minor, 70 BPM, 4/4.

Bars 1-8   intro  - solo piano (the dreamy_piano_sketch loop)
Bars 9-12  build  - pulsing piano chords, drums enter, snare roll, one beat of silence
Bars 13-20 drop   - piano hook + chords, sub bass, drums
"""
import random
import struct
import sys

PPQ = 480
BPM = 70
BAR = 4
N_BARS = 20
random.seed(11)

PIANO, BASS, DRUMS = 0, 1, 9
notes = []  # (channel, start_beat, end_beat, pitch, velocity)


def add(ch, start, dur, pitch, vel):
    notes.append((ch, start, start + dur, pitch, vel))


# ---------------- Intro (bars 1-8): original sketch ----------------
INTRO_LH = [
    [(0.0, 45), (0.5, 52), (1.0, 59), (2.5, 60)],              # Am(add9)
    [(0.0, 41), (0.5, 48), (1.0, 52), (2.5, 57)],              # Fmaj7
    [(0.0, 36), (0.5, 43), (1.0, 52), (2.5, 59)],              # Cmaj7
    [(0.0, 43), (0.5, 50), (1.0, 57), (2.5, 62)],              # G6/9
    [(0.0, 45), (0.5, 52), (1.0, 59), (2.5, 60)],              # Am(add9)
    [(0.0, 41), (0.5, 48), (1.0, 52), (2.0, 57), (3.0, 59)],   # Fmaj7#11
    [(0.0, 38), (0.5, 45), (1.0, 53), (2.5, 60), (3.0, 64)],   # Dm9
]
for bar, voicing in enumerate(INTRO_LH):
    for i, (onset, pitch) in enumerate(voicing):
        add(PIANO, bar * BAR + onset, BAR - onset, pitch,
            (54 if i == 0 else 42) + random.randint(-5, 5))
b = 7 * BAR  # Esus4 -> Em7
for onset, dur, pitch, vel in [(0, 4, 40, 52), (0.5, 3.5, 47, 41), (1, 1, 57, 39),
                               (2, 2, 55, 40), (3, 1, 62, 36)]:
    add(PIANO, b + onset, dur, pitch, vel)

INTRO_MELODY = [
    (0, 1.0, 76, 0.75, 62), (0, 1.75, 74, 0.25, 52), (0, 2.0, 76, 0.5, 58), (0, 2.5, 79, 1.5, 66),
    (1, 1.5, 76, 0.5, 56), (1, 2.0, 72, 2.0, 60),
    (2, 1.0, 71, 0.5, 54), (2, 1.5, 72, 0.5, 58), (2, 2.0, 74, 0.5, 62), (2, 2.5, 76, 1.5, 68),
    (3, 1.0, 74, 2.5, 60), (3, 3.0, 88, 1.0, 30),
    (4, 1.0, 76, 0.75, 64), (4, 1.75, 74, 0.25, 53), (4, 2.0, 76, 0.5, 60), (4, 2.5, 83, 1.0, 72),
    (4, 3.5, 81, 0.5, 58),
    (5, 1.0, 79, 0.75, 62), (5, 1.75, 76, 0.25, 50), (5, 2.0, 71, 2.0, 55),
    (6, 1.0, 72, 0.5, 56), (6, 1.5, 74, 0.5, 60), (6, 2.0, 77, 0.5, 66), (6, 2.5, 76, 1.5, 61),
    (7, 1.0, 74, 1.0, 54), (7, 2.0, 71, 2.0, 47), (7, 3.0, 83, 1.0, 26),
]
for bar, onset, pitch, dur, vel in INTRO_MELODY:
    add(PIANO, bar * BAR + onset, dur, pitch, vel + random.randint(-3, 3))

# ---------------- Build (bars 9-12): F | G | Am | E ----------------
BUILD_CHORDS = [
    (41, [57, 60, 64]),   # F  : F2 | A3 C4 E4
    (43, [59, 62, 67]),   # G  : G2 | B3 D4 G4
    (45, [60, 64, 69]),   # Am : A2 | C4 E4 A4
    (40, [59, 64, 68]),   # E  : E2 | B3 E4 G#4 (major V for extra pull into the drop)
]
for i, (root, chord) in enumerate(BUILD_CHORDS):
    bar = 8 + i
    start = bar * BAR
    last = 3.0 if i == 3 else 4.0          # beat 4 of bar 12 is silent
    add(PIANO, start, last, root, 60 + i * 6)
    t = 0.0
    while t < last:                        # eighth-note chord pulses, crescendo
        vel = int(40 + (i * 4 + t) * 3.2) + random.randint(-3, 3)
        for p in chord:
            add(PIANO, start + t, 0.45, p, vel)
        t += 0.5
    add(PIANO, start, 1.5, chord[-1] + 12, 58 + i * 5)   # high top note on each downbeat
    add(BASS, start, last, root - 12, 70 + i * 6)

# drums in the build: kicks bars 11-12, snare roll accelerating into the gap
for beat in range(4):
    add(DRUMS, 10 * BAR + beat, 0.25, 36, 80 + beat * 3)
for beat in range(3):
    add(DRUMS, 11 * BAR + beat, 0.25, 36, 94)
t = 10 * BAR
step_plan = [(10 * BAR, 11 * BAR, 1.0), (11 * BAR, 11 * BAR + 2, 0.5),
             (11 * BAR + 2, 11 * BAR + 2.5, 0.25), (11 * BAR + 2.5, 11 * BAR + 3, 0.125)]
for a, z, step in step_plan:
    t = a
    while t < z - 1e-9:
        vel = int(50 + (t - 10 * BAR) / 7 * 70)
        add(DRUMS, t, 0.1, 38, min(120, vel))
        t += step

# ---------------- Drop (bars 13-20) ----------------
DROP_CHORDS = [  # bass root (sub), piano LH voicing
    (33, [45, 52, 59, 60]),   # Am(add9)
    (29, [41, 48, 52, 57]),   # Fmaj7
    (36, [48, 55, 59, 64]),   # Cmaj7
    (31, [43, 50, 57, 62]),   # G6/9
    (33, [45, 52, 59, 60]),   # Am(add9)
    (29, [41, 48, 52, 59]),   # Fmaj7#11
    (38, [50, 53, 57, 64]),   # Dm9
    (28, [40, 47, 55, 62]),   # Em7 (sus4 in the melody)
]
DROP_MELODY = [  # bar-in-drop, onset, pitch, dur
    (0, 0.0, 76, 1.0), (0, 1.0, 79, 0.5), (0, 1.5, 81, 0.5), (0, 2.0, 83, 1.0), (0, 3.0, 81, 0.5), (0, 3.5, 79, 0.5),
    (1, 0.0, 76, 1.5), (1, 1.5, 72, 0.5), (1, 2.0, 76, 2.0),
    (2, 0.0, 79, 1.0), (2, 1.0, 76, 0.5), (2, 1.5, 74, 0.5), (2, 2.0, 72, 1.0), (2, 3.0, 71, 1.0),
    (3, 0.0, 74, 3.0), (3, 3.5, 76, 0.5),
    (4, 0.0, 76, 1.0), (4, 1.0, 79, 0.5), (4, 1.5, 81, 0.5), (4, 2.0, 83, 1.0), (4, 3.0, 84, 1.0),
    (5, 0.0, 83, 1.0), (5, 1.0, 81, 1.0), (5, 2.0, 76, 2.0),
    (6, 0.0, 77, 1.0), (6, 1.0, 76, 0.5), (6, 1.5, 74, 0.5), (6, 2.0, 72, 1.0), (6, 3.0, 74, 1.0),
    (7, 0.0, 76, 1.0), (7, 1.0, 74, 1.0), (7, 2.0, 71, 2.0),
]
D0 = 12 * BAR
for i, (root, voicing) in enumerate(DROP_CHORDS):
    start = D0 + i * BAR
    for onset, dur in [(0.0, 2.25), (2.5, 1.5)]:           # syncopated chord hits
        for j, p in enumerate(voicing):
            add(PIANO, start + onset, dur, p, (66 if onset == 0 else 54) - j * 2 + random.randint(-4, 4))
    for onset, dur, vel in [(0.0, 1.5, 100), (1.75, 0.5, 82), (2.5, 1.5, 92)]:   # sub bass
        add(BASS, start + onset, dur, root, vel + random.randint(-4, 4))
for bar, onset, pitch, dur in DROP_MELODY:
    accent = 84 if onset == 0 else 72
    add(PIANO, D0 + bar * BAR + onset, dur, pitch, accent + random.randint(-5, 5))
    if onset == 0:                                          # octave doubling on downbeats
        add(PIANO, D0 + bar * BAR + onset, dur, pitch + 12, 58 + random.randint(-4, 4))

add(DRUMS, D0, 2.0, 49, 118)                                # crash on the drop
add(DRUMS, D0 + 4 * BAR, 2.0, 49, 100)
for i in range(8):
    start = D0 + i * BAR
    for k in (0.0, 1.75, 2.5):
        add(DRUMS, start + k, 0.25, 36, (112 if k == 0 else 96) + random.randint(-4, 4))
    for s in (1.0, 3.0):
        add(DRUMS, start + s, 0.25, 38, 104 + random.randint(-5, 5))
        add(DRUMS, start + s, 0.25, 39, 70 + random.randint(-5, 5))
    hats = [x * 0.5 for x in range(8)]
    if i in (3, 7):                                         # hi-hat roll at phrase ends
        hats = [x * 0.5 for x in range(6)] + [3.0 + x * 0.125 for x in range(8)]
    for h in hats:
        v = (78 if h % 1 == 0 else 58) + random.randint(-6, 6)
        add(DRUMS, start + h, 0.1, 42, v)
    add(DRUMS, start + 3.5, 0.4, 46, 66)                    # open hat lift

# ---------------- Write MIDI ----------------
END = N_BARS * BAR * PPQ


def tick(beat):
    return int(round(beat * PPQ))


def vlq(n):
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    return bytes(reversed(out))


def meta(t, payload):
    return b"\xff" + bytes([t]) + vlq(len(payload)) + payload


def track(name, events, program=None, ch=0):
    chunks = [vlq(0), meta(0x03, name.encode())]
    if program is not None:
        chunks += [vlq(0), bytes([0xC0 | ch, program])]
    now = 0
    for t, _, msg in sorted(events, key=lambda e: (e[0], e[1])):
        chunks += [vlq(t - now), msg]
        now = t
    chunks += [vlq(END - now), meta(0x2F, b"")]
    data = b"".join(chunks)
    return b"MTrk" + struct.pack(">I", len(data)) + data


per_channel = {PIANO: [], BASS: [], DRUMS: []}
for ch, start, end, pitch, vel in notes:
    s, e = tick(start), tick(end)
    if s % (PPQ * BAR) and ch != DRUMS:
        s += random.randint(-10, 10)                        # human timing on piano/bass
    e = min(e - 6, END)
    vel = max(1, min(127, vel))
    per_channel[ch].append((s, 1, bytes([0x90 | ch, pitch, vel])))
    per_channel[ch].append((e, 0, bytes([0x80 | ch, pitch, 0])))

# sustain pedal on piano: every bar in the intro/drop, released in the tight build
for bar in list(range(8)) + list(range(12, 20)):
    per_channel[PIANO].append((tick(bar * BAR) + 20, 2, bytes([0xB0, 64, 100])))
    per_channel[PIANO].append((tick((bar + 1) * BAR) - 10, 0, bytes([0xB0, 64, 0])))

conductor = b"".join([
    vlq(0), meta(0x03, b"Dreamy Piano Drop"),
    vlq(0), meta(0x58, bytes([4, 2, 24, 8])),
    vlq(0), meta(0x51, int(60_000_000 / BPM).to_bytes(3, "big")),
    vlq(0), meta(0x59, bytes([0, 1])),
    vlq(END), meta(0x2F, b""),
])
tracks = [
    b"MTrk" + struct.pack(">I", len(conductor)) + conductor,
    track("Acoustic Grand Piano", per_channel[PIANO], program=0, ch=PIANO),
    track("Sub Bass", per_channel[BASS], program=38, ch=BASS),
    track("Drums", per_channel[DRUMS], program=0, ch=DRUMS),
]
out = sys.argv[1] if len(sys.argv) > 1 else "dreamy_piano_drop.mid"
with open(out, "wb") as f:
    f.write(b"MThd" + struct.pack(">IHHH", 6, 1, len(tracks), PPQ) + b"".join(tracks))
print(f"wrote {out}: {len(notes)} notes, {N_BARS} bars")
