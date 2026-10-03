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
const TOUCHME_MIN_NOTE = 48;  // TouchMe input range starts at C3
const TOUCHME_MAX_NOTE = 84;  // TouchMe input range ends at C6

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

    const octave = Math.floor(relative / 12);
    const semitone = relative % 12;

    let nearest = scale.intervals[0];
    let distance = Infinity;

    for (const interval of scale.intervals) {
        const currentDistance = Math.abs(interval - semitone);

        if (currentDistance < distance) {
            nearest = interval;
            distance = currentDistance;
        }
    }

    return TOUCHME_ROOT_NOTE + octave * 12 + nearest;
}
