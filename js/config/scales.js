export const SCALES = [
    {
        id: "do-only",
        label: "DO — TOUTES LES HAUTEURS",
        intervals: [0]
    }
];

const TOUCHME_MIN_NOTE = 48;
const TOUCHME_MAX_NOTE = 84;

// The TouchMe keeps its full playable range, but every chromatic input
// is folded onto the nearest lower C. This gives several C pitches:
// C3 (48), C4 (60), C5 (72), C6 (84).
export function quantizeTouchMeNote(note, scaleIndex = 0) {
    if (!Number.isFinite(note)) return TOUCHME_MIN_NOTE;

    const clamped = Math.max(
        TOUCHME_MIN_NOTE,
        Math.min(TOUCHME_MAX_NOTE, Math.round(note))
    );

    const octave = Math.floor((clamped - TOUCHME_MIN_NOTE) / 12);
    const baseC = TOUCHME_MIN_NOTE + octave * 12;

    return Math.min(baseC, TOUCHME_MAX_NOTE);
}
