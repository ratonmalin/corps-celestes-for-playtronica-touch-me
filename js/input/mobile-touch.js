import { quantizeTouchMeNote } from "../config/scales.js";

const TOUCHME_MIN_NOTE = 48;
const TOUCHME_MAX_NOTE = 84;

export class MobileTouchInput {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.active = new Map();
        this.scaleIndex = 0;
        this.sensitivity = 1;

        this.handlePointerDown = this.handlePointerDown.bind(this);
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        this.releaseAll = this.releaseAll.bind(this);
    }

    setSensitivity(value) {
        const numeric = Number(value);
        this.sensitivity = Number.isFinite(numeric)
            ? Math.max(0.25, Math.min(3, numeric))
            : 1;
    }

    setScale(index) {
        this.scaleIndex = Math.max(0, Math.min(2, Number(index) || 0));

        for (const pointerId of [...this.active.keys()]) {
            this.releasePointer(pointerId);
        }
    }

    start() {
        if (!this.isTouchDevice()) return false;

        document.addEventListener("pointerdown", this.handlePointerDown, { passive: false });
        document.addEventListener("pointermove", this.handlePointerMove, { passive: false });
        document.addEventListener("pointerup", this.handlePointerUp, { passive: false });
        document.addEventListener("pointercancel", this.handlePointerUp, { passive: false });
        window.addEventListener("blur", this.releaseAll);
        document.addEventListener("visibilitychange", this.releaseAll);

        return true;
    }

    isTouchDevice() {
        return window.matchMedia("(pointer: coarse)").matches ||
            navigator.maxTouchPoints > 0;
    }

    isInteractiveTarget(target) {
        return Boolean(target?.closest?.(
            "button, input, select, textarea, a, label, output"
        ));
    }

    getRawNote(event) {
        const height = Math.max(1, window.innerHeight);
        const position = Math.max(
            0,
            Math.min(1, 1 - event.clientY / height)
        );

        return TOUCHME_MIN_NOTE +
            position * (TOUCHME_MAX_NOTE - TOUCHME_MIN_NOTE);
    }

    getIntensity(event) {
        const contact = Math.max(
            Number(event.width) || 0,
            Number(event.height) || 0
        );

        if (contact > 1) {
            return Math.max(0.08, Math.min(1, contact / 70));
        }

        const pressure = Number(event.pressure);
        return Math.max(0.08, Math.min(1, pressure || 0.5));
    }

    emitNoteOn(pointerId, event, rawNote) {
        const note = quantizeTouchMeNote(rawNote, this.scaleIndex);
        const intensity = Math.max(
            0,
            Math.min(1, this.getIntensity(event) * this.sensitivity)
        );

        this.active.set(pointerId, {
            note,
            rawNote,
            channel: 0
        });

        this.eventBus.emit({
            type: "noteon",
            note,
            rawNote: Math.round(rawNote),
            velocity: 1,
            channel: 0,
            source: "touch",
            timestamp: performance.now(),
            touchIntensity: intensity,
            chordIntervals: getDiatonicTriadIntervals(note, this.scaleIndex)
        });

        this.eventBus.emit({
            type: "intensity",
            value: intensity,
            note,
            rawNote: Math.round(rawNote),
            channel: 0,
            source: "touch"
        });
    }

    handlePointerDown(event) {
        if (event.pointerType !== "touch") return;
        if (this.isInteractiveTarget(event.target)) return;

        event.preventDefault();
        this.emitNoteOn(event.pointerId, event, this.getRawNote(event));
    }

    handlePointerMove(event) {
        if (event.pointerType !== "touch") return;

        const active = this.active.get(event.pointerId);
        if (!active) return;

        event.preventDefault();

        const rawNote = this.getRawNote(event);
        const nextNote = quantizeTouchMeNote(rawNote, this.scaleIndex);
        const intensity = Math.max(
            0,
            Math.min(1, this.getIntensity(event) * this.sensitivity)
        );

        if (nextNote !== active.note) {
            this.eventBus.emit({
                type: "noteoff",
                note: active.note,
                rawNote: Math.round(active.rawNote),
                velocity: 0,
                channel: active.channel,
                source: "touch",
                timestamp: performance.now()
            });

            this.emitNoteOn(event.pointerId, event, rawNote);
            return;
        }

        active.rawNote = rawNote;

        this.eventBus.emit({
            type: "intensity",
            value: intensity,
            note: active.note,
            rawNote: Math.round(rawNote),
            channel: active.channel,
            source: "touch"
        });
    }

    handlePointerUp(event) {
        if (event.pointerType !== "touch") return;
        if (!this.active.has(event.pointerId)) return;

        event.preventDefault();
        this.releasePointer(event.pointerId);
    }

    releasePointer(pointerId) {
        const active = this.active.get(pointerId);
        if (!active) return;

        this.active.delete(pointerId);

        this.eventBus.emit({
            type: "noteoff",
            note: active.note,
            rawNote: Math.round(active.rawNote),
            velocity: 0,
            channel: active.channel,
            source: "touch",
            timestamp: performance.now()
        });
    }

    releaseAll() {
        for (const pointerId of [...this.active.keys()]) {
            this.releasePointer(pointerId);
        }
    }
}

function getDiatonicTriadIntervals(note, scaleIndex) {
    const scales = [
        [0, 2, 4, 7, 9],
        [0, 3, 5, 7, 10],
        [0, 2, 5, 7, 9]
    ];

    const scale = scales[Math.max(0, Math.min(2, Number(scaleIndex) || 0))];
    const pitchClass = ((note - 24) % 12 + 12) % 12;
    const degree = scale.indexOf(pitchClass);

    if (degree < 0) return [0, scale[1], scale[2]];

    const intervals = [];
    for (let step = 0; step < 3; step++) {
        const target = degree + step * 2;
        const octave = Math.floor(target / scale.length);
        const targetIndex = target % scale.length;
        intervals.push(
            scale[targetIndex] + octave * 12 - scale[degree]
        );
    }

    return intervals;
}
