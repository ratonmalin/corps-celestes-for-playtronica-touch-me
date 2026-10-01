export const SCALES = [
    {
        id: "major-pentatonic",
        label: "PENTATONIQUE MAJEURE",
        intervals: [0, 2, 4, 7, 9]
    },
    {
        id: "minor-pentatonic",
        label: "PENTATONIQUE MINEURE",
        intervals: [0, 3, 5, 7, 10]
    },
    {
        id: "suspended",
        label: "SUSPENDUE",
        intervals: [0, 2, 5, 7, 9]
    }
];

const TOUCHME_ROOT_NOTE = 24;
const TOUCHME_MIN_NOTE = 48;
const TOUCHME_MAX_NOTE = 84;

export function quantizeTouchMeNote(note, scaleIndex = 0) {
    if (!Number.isFinite(note)) return TOUCHME_ROOT_NOTE;

    const scale = SCALES[
        Math.max(0, Math.min(SCALES.length - 1, scaleIndex))
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
