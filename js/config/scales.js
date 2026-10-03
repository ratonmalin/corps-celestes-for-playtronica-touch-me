export const SCALES = [
    {
        id: "major",
        label: "MAJEURE",
        intervals: [0, 2, 4, 5, 7, 9, 11, 12]
    },
    {
        id: "minor",
        label: "MINEURE",
        intervals: [0, 2, 3, 5, 7, 8, 10, 12]
    },
    {
        id: "suspended",
        label: "SUSPENDUE",
        intervals: [0, 2, 5, 7, 9, 10, 12, 14]
    }
];

const TOUCHME_ROOT_NOTE = 36; // C2
const TOUCHME_MIN_NOTE = 48;
const TOUCHME_MAX_NOTE = 84;
const TOUCHME_INPUT_COUNT = 16;

export function quantizeTouchMeNote(note, scaleIndex = 0) {
    if (!Number.isFinite(note)) return TOUCHME_ROOT_NOTE;

    const scale = SCALES[
        Math.max(0, Math.min(SCALES.length - 1, Number(scaleIndex) || 0))
    ];

    const relative = Math.max(
        0,
        Math.min(
            TOUCHME_MAX_NOTE - TOUCHME_MIN_NOTE,
            Math.round(note - TOUCHME_MIN_NOTE)
        )
    );

    // Compress the TouchMe's MIDI range into its 16 musical positions.
    // This keeps the complete playable range compact: C2 to D4 in major.
    const position = Math.round(
        relative * (TOUCHME_INPUT_COUNT - 1) /
        (TOUCHME_MAX_NOTE - TOUCHME_MIN_NOTE)
    );

    const degreeCount = scale.intervals.length;
    const octave = Math.floor(position / degreeCount);
    const degree = position % degreeCount;

    return TOUCHME_ROOT_NOTE +
        octave * 12 +
        scale.intervals[degree];
}
