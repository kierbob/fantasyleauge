"""Generate soft_pool_mood.mid: original 24-bar piece, C# minor, 68 BPM, 4/4 with a triplet (12/8) feel.

Style traits only (no melody/chords taken from any existing song):
  - rolling triplet-eighth left hand, very low velocities, una corda + sustain pedal
  - singing mid-register melody, long notes, lots of air
  - "cold" chromatic harmony turns (Neapolitan D major, chromatic-mediant F major)
  - strings (slow ensemble) instead of synths
  - the drop = the same piano melody chopped/stuttered over a soft dance beat

Bars 1-8   A   solo piano
Bars 9-12  B   strings enter, melody climbs, cold harmonic turn
Bars 13-16 build  chopped piano + string swell, half bar of silence
Bars 17-24 drop   chopped piano hook, strings, soft 12/8 dance beat
"""
import random
import struct
import sys

PPQ = 480
BPM = 68
E = PPQ // 3          # one triplet eighth = 160 ticks
BAR = 12              # triplet eighths per 4/4 bar
N_BARS = 24
random.seed(3)

PIANO, STRINGS, DRUMS = 0, 1, 9
notes = []            # (ch, start_e, end_e, pitch, vel, humanize?)


def add(ch, start, dur, pitch, vel, human=True):
    notes.append((ch, start, start + dur, pitch, int(vel), human))


V = {  # left-hand voicings: root, then three upper tones for the ripple
    "C#m":   [37, 44, 52, 56],
    "Amaj7": [33, 40, 49, 56],
    "E/G#":  [44, 52, 56, 59],
    "F#m7":  [42, 49, 52, 57],
    "D":     [38, 45, 54, 57],      # Neapolitan: the "cold" turn
    "G#sus": [44, 51, 56, 61],
    "G#":    [44, 51, 56, 60],      # B# leading tone
    "Fmaj7": [41, 48, 52, 57],      # chromatic mediant
    "C#m/G#": [44, 49, 52, 56],
    "G#7sus": [44, 51, 54, 61],
    "A":     [33, 40, 49, 52],
    "B":     [35, 42, 51, 54],
    "G#m":   [44, 51, 56, 59],
}

# ripple: (eighth, voice index, duration) - root held, upper tones rolling in triplets
RIPPLE = [(0, 0, 12), (1, 1, 5), (2, 2, 4), (4, 3, 2), (6, 1, 6), (7, 2, 5), (8, 3, 4)]


def left_hand(bar, chord, base_vel, half=None):
    start = bar * BAR
    for e, idx, dur in RIPPLE:
        if half == "first" and e >= 6:
            continue
        if half == "second" and e < 6:
            continue
        v = base_vel + (6 if idx == 0 else 0) - (3 if e in (4, 8) else 0)
        add(PIANO, start + e, min(dur, BAR - e), V[chord][idx], v + random.randint(-3, 3))


def melody(bar, phrase, base_vel, octave=0, chop=False):
    for e, pitch, dur in phrase:
        start = bar * BAR + e
        v = base_vel + (4 if e % 6 == 0 else 0) + random.randint(-3, 3)
        if not chop or dur < 4:
            add(PIANO, start, dur, pitch + octave, v)
        else:  # sampled-and-chopped feel: stutter "x x . x" then let the tail ring
            add(PIANO, start, 1, pitch + octave, v)
            add(PIANO, start + 1, 1, pitch + octave, v * 0.72)
            add(PIANO, start + 3, dur - 3, pitch + octave, v * 0.88)


# --------- A section (bars 1-8): solo piano ---------
A_CHORDS = ["C#m", "Amaj7", "E/G#", "F#m7", "C#m", "Amaj7", "D", None]
A_MELODY = [
    [(3, 68, 3), (6, 73, 4), (10, 71, 2)],
    [(0, 76, 5), (5, 75, 1), (6, 73, 6)],
    [(0, 71, 3), (3, 68, 3), (9, 71, 3)],
    [(0, 69, 9)],
    [(3, 68, 3), (6, 73, 3), (9, 76, 3)],
    [(0, 80, 5), (5, 78, 1), (6, 76, 6)],
    [(0, 78, 3), (3, 74, 3), (6, 69, 6)],       # D natural: the cold note
    [(0, 73, 6), (6, 72, 6)],                   # sus4 -> B#, left hanging
]
for bar in range(8):
    if A_CHORDS[bar]:
        left_hand(bar, A_CHORDS[bar], 24)
    else:
        left_hand(bar, "G#sus", 24, "first")
        left_hand(bar, "G#", 23, "second")
    melody(bar, A_MELODY[bar], 40)

# --------- B section (bars 9-12): strings enter ---------
B_CHORDS = ["Amaj7", "Fmaj7", "C#m/G#", "G#7sus"]
B_MELODY = [
    [(3, 73, 3), (6, 76, 3), (9, 80, 3)],
    [(0, 81, 6), (6, 76, 6)],
    [(0, 76, 3), (3, 75, 3), (6, 73, 6)],
    [(0, 75, 9)],
]
STR_B = [[45, 52, 61, 64], [41, 53, 60, 64], [44, 52, 61, 64], [44, 51, 54, 61]]
for i in range(4):
    bar = 8 + i
    left_hand(bar, B_CHORDS[i], 27)
    melody(bar, B_MELODY[i], 46)
    for j, p in enumerate(STR_B[i]):
        add(STRINGS, bar * BAR, BAR, p, 34 + i * 3 - j * 2, human=False)

# --------- Build (bars 13-16): A | B | G#m | D + silence ---------
BUILD = ["A", "B", "G#m", "D"]
STR_BUILD = [[45, 57, 61, 64], [47, 54, 59, 63], [44, 56, 59, 63], [50, 57, 62, 66]]
CHOP_MOTIF = [(0, 73), (1, 73), (3, 76), (5, 75), (6, 73), (7, 73), (9, 71), (11, 68)]
for i in range(4):
    bar = 12 + i
    start = bar * BAR
    end = 6 if i == 3 else 12                               # bar 16 goes silent halfway
    add(PIANO, start, end, V[BUILD[i]][0], 36 + i * 5)
    add(PIANO, start, end, V[BUILD[i]][0] + 12, 30 + i * 5)
    for e, p in CHOP_MOTIF:
        if e < end:
            shift = 3 if i == 1 else (0 if i != 3 else 2)   # motif follows the harmony
            add(PIANO, start + e, 1, p + shift, 38 + i * 6 + e + random.randint(-3, 3))
    for j, p in enumerate(STR_BUILD[i]):
        add(STRINGS, start, end, p, 40 + i * 9 - j * 2, human=False)
for e in range(0, 18):                                      # soft kick on each beat, bars 15-16
    if e % 3 == 0 and e < 18:
        add(DRUMS, 14 * BAR + e, 1, 36, 48 + e * 2, human=False)
for e in range(0, 6):                                       # rim clicks tightening into the gap
    add(DRUMS, 15 * BAR + e, 1, 37, 50 + e * 8, human=False)

# --------- Drop (bars 17-24): chopped piano over a soft 12/8 dance beat ---------
D0 = 16
STR_DROP = [[49, 56, 64, 68], [45, 56, 61, 64], [44, 56, 59, 64], [42, 57, 61, 64],
            [49, 56, 64, 68], [45, 56, 61, 68], [38, 54, 57, 62], [44, 56, 60, 63]]
for i in range(8):
    bar = D0 + i
    start = bar * BAR
    chord = A_CHORDS[i]
    if chord:
        left_hand(bar, chord, 34)
    else:
        left_hand(bar, "G#sus", 34, "first")
        left_hand(bar, "G#", 33, "second")
    melody(bar, A_MELODY[i], 54, octave=12 if i >= 4 else 0, chop=True)
    for j, p in enumerate(STR_DROP[i]):
        add(STRINGS, start, BAR, p, 44 - j * 2 + random.randint(-2, 2), human=False)
    # drums: kick on every beat, clap on 2 and 4, soft shuffled hats on the triplet "&"s
    for beat in range(4):
        add(DRUMS, start + beat * 3, 1, 36, 78 + (6 if beat == 0 else 0) + random.randint(-3, 3), human=False)
        add(DRUMS, start + beat * 3 + 2, 1, 42, 44 + random.randint(-4, 4), human=False)
        add(DRUMS, start + beat * 3 + 1, 1, 42, 30 + random.randint(-4, 4), human=False)
    for beat in (1, 3):
        add(DRUMS, start + beat * 3, 1, 39, 62 + random.randint(-3, 3), human=False)
    if i in (3, 7):
        add(DRUMS, start + 11, 1, 46, 50, human=False)       # open hat into the next phrase
add(DRUMS, D0 * BAR, 6, 49, 70, human=False)                 # gentle crash on the drop
add(DRUMS, (D0 + 4) * BAR, 6, 49, 58, human=False)

# ---------------- Write MIDI ----------------
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


def track(name, events, program=None, ch=0):
    chunks = [vlq(0), meta(0x03, name.encode())]
    if program is not None:
        chunks += [vlq(0), bytes([0xC0 | ch, program])]
    now = 0
    for t, _, msg in sorted(events, key=lambda x: (x[0], x[1])):
        chunks += [vlq(t - now), msg]
        now = t
    chunks += [vlq(END - now), meta(0x2F, b"")]
    data = b"".join(chunks)
    return b"MTrk" + struct.pack(">I", len(data)) + data


per_channel = {PIANO: [], STRINGS: [], DRUMS: []}
for ch, start, end, pitch, vel, human in notes:
    s, e = start * E, end * E
    if human and s % (BAR * E):
        s += random.randint(-8, 8)
    e = min(e - 8, END)
    per_channel[ch].append((s, 1, bytes([0x90 | ch, pitch, max(1, min(127, vel))])))
    per_channel[ch].append((e, 0, bytes([0x80 | ch, pitch, 0])))

# piano pedals: sustain re-pedalled each bar (half-bar in the last A bar for the sus -> G# change),
# una corda (soft pedal) down for the A and B sections
for bar in range(N_BARS):
    if 12 <= bar <= 15:
        continue                                              # dry, tight build
    points = [0, 6] if bar in (7, 23) else [0]
    for k, p in enumerate(points):
        nxt = points[k + 1] if k + 1 < len(points) else BAR
        per_channel[PIANO].append(((bar * BAR + p) * E + 20, 2, bytes([0xB0, 64, 100])))
        per_channel[PIANO].append(((bar * BAR + nxt) * E - 10, 0, bytes([0xB0, 64, 0])))
per_channel[PIANO].append((0, 0, bytes([0xB0, 67, 127])))
per_channel[PIANO].append((12 * BAR * E, 0, bytes([0xB0, 67, 0])))
per_channel[STRINGS].append((0, 0, bytes([0xB0 | STRINGS, 91, 80])))   # a bit of reverb send

conductor = b"".join([
    vlq(0), meta(0x03, b"Soft Pool Mood"),
    vlq(0), meta(0x58, bytes([4, 2, 24, 8])),
    vlq(0), meta(0x51, int(60_000_000 / BPM).to_bytes(3, "big")),
    vlq(0), meta(0x59, bytes([4, 1])),                       # C# minor
    vlq(END), meta(0x2F, b""),
])
tracks = [
    b"MTrk" + struct.pack(">I", len(conductor)) + conductor,
    track("Soft Piano", per_channel[PIANO], program=0, ch=PIANO),
    track("Strings", per_channel[STRINGS], program=49, ch=STRINGS),   # String Ensemble 2 (slow)
    track("Drums", per_channel[DRUMS], program=0, ch=DRUMS),
]
out = sys.argv[1] if len(sys.argv) > 1 else "soft_pool_mood.mid"
with open(out, "wb") as f:
    f.write(b"MThd" + struct.pack(">IHHH", 6, 1, len(tracks), PPQ) + b"".join(tracks))
print(f"wrote {out}: {len(notes)} notes, {N_BARS} bars")
