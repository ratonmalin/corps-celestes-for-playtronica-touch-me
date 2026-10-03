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

    // Map each TouchMe input position to the next degree of the scale,
    // rather than nearest-note quantization. This keeps every input step
    // distinct and avoids repeated notes, especially in the upper range.
    const degreeCount = scale.intervals.length;
    const octave = Math.floor(relative / degreeCount);
    const degree = relative % degreeCount;

    return TOUCHME_ROOT_NOTE +
        octave * 12 +
        scale.intervals[degree];
}
