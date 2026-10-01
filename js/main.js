import { VisualEngine } from "./visuals/visual-engine.js";

const $ = id => document.getElementById(id);

const ui = {
    connect: $("connect"),
    audio: $("audio"),
    status: $("status"),
    device: $("device"),
    led: $("led"),
    level: $("level"),
    cc: $("cc-value"),
    ccMeter: $("cc-meter"),
    freq: $("freq"),
    freqMeter: $("freq-meter"),
    sensitivity: $("sensitivity"),
    sensOut: $("sens-out"),
    scale: $("scale"),
    planet: $("planet")
};

const eventBus = {
    listeners: new Map(),

    on(type, callback) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set());
        }

        this.listeners.get(type).add(callback);
    },

    emit(event) {
        const callbacks = this.listeners.get(event?.type);

        if (!callbacks) return;

        for (const callback of callbacks) {
            callback(event);
        }
    }
};

const visualEngine = new VisualEngine(eventBus);

let midi = null;
let input = null;
let audio = null;
let osc = null;
let gain = null;
let filter = null;
let started = false;

let raw = 0;
let smoothed = 0;
let ccNumber = null;
let lastSignalAt = 0;
let activeNote = null;
let raf = 0;

const scales = [
    [0, 2, 4, 7, 9],
    [0, 2, 3, 5, 7, 9, 10],
    Array.from({ length: 12 }, (_, index) => index)
];

const clamp = (value, min = 0, max = 1) =>
    Math.max(min, Math.min(max, value));

function noteFrequency(value) {
    const root = 36;
    const scale = scales[Number(ui.scale.value)] ?? scales[0];
    const octaves = 3;
    const steps = scale.length * octaves;
    const index = Math.round(
        clamp(value) * Math.max(0, steps - 1)
    );
    const semitone =
        scale[index % scale.length] +
        12 * Math.floor(index / scale.length);

    return 440 * Math.pow(2, (root + semitone - 69) / 12);
}

function noteFromSignal(value) {
    const scale = scales[Number(ui.scale.value)] ?? scales[0];
    const steps = scale.length * 3;
    const index = Math.round(
        clamp(value) * Math.max(0, steps - 1)
    );

    return (
        48 +
        scale[index % scale.length] +
        12 * Math.floor(index / scale.length)
    );
}

function renderSignal() {
    const pct = Math.round(smoothed * 100);
    const hz = noteFrequency(smoothed);

    ui.level.innerHTML = pct + "<span>%</span>";
    ui.cc.textContent =
        ccNumber === null ? "—" : String(ccNumber).padStart(3, "0");

    ui.ccMeter.style.width = (smoothed * 100) + "%";
    ui.freq.textContent = Math.round(hz) + " Hz";
    ui.freqMeter.style.width =
        (clamp((hz - 60) / 700) * 100) + "%";

    ui.planet.style.filter =
        "brightness(" + (1 + smoothed * 0.65) +
        ") saturate(" + (1 + smoothed * 0.8) + ")";
    ui.planet.style.transform =
        "scale(" + (1 + smoothed * 0.07) + ")";

    ui.led.classList.toggle("on", smoothed > 0.015);

    if (gain && started && audio) {
        osc.frequency.setTargetAtTime(
            hz,
            audio.currentTime,
            0.035
        );

        filter.frequency.setTargetAtTime(
            450 + smoothed * 5000,
            audio.currentTime,
            0.04
        );

        gain.gain.setTargetAtTime(
            0.025 + smoothed * 0.16,
            audio.currentTime,
            0.05
        );
    }
}

function emitTouchNote(forceRelease = false) {
    const effective = clamp(
        smoothed * Number(ui.sensitivity.value)
    );

    if (forceRelease || effective < 0.025) {
        if (activeNote !== null) {
            eventBus.emit({
                type: "noteoff",
                source: "touchme",
                channel: 0,
                note: activeNote
            });

            activeNote = null;
        }

        return;
    }

    const nextNote = noteFromSignal(effective);
    const velocity = clamp(
        0.25 + effective * 0.75
    );

    if (activeNote === null) {
        activeNote = nextNote;

        eventBus.emit({
            type: "noteon",
            source: "touchme",
            channel: 0,
            note: activeNote,
            velocity
        });

        return;
    }

    if (nextNote !== activeNote) {
        eventBus.emit({
            type: "noteoff",
            source: "touchme",
            channel: 0,
            note: activeNote
        });

        activeNote = nextNote;

        eventBus.emit({
            type: "noteon",
            source: "touchme",
            channel: 0,
            note: activeNote,
            velocity
        });

        return;
    }

    eventBus.emit({
        type: "noteon",
        source: "touchme",
        channel: 0,
        note: activeNote,
        velocity
    });
}

function applySignal(value, cc = null) {
    raw = clamp(value);
    ccNumber = cc;
    lastSignalAt = performance.now();

    smoothed += (raw - smoothed) * 0.22;

    renderSignal();
    emitTouchNote();
}

function handleMidi(event) {
    if (!event?.data || event.data.length < 3) return;

    const [status, data, value] = event.data;
    const type = status & 0xf0;
    const channel = status & 0x0f;

    if (type === 0xb0) {
        applySignal(value / 127, data);
        return;
    }

    if (type === 0x90 && value > 0) {
        const normalized = value / 127;

        applySignal(normalized, data);

        eventBus.emit({
            type: "noteon",
            source: "touchme-midi",
            channel,
            note: data,
            velocity: normalized
        });

        return;
    }

    if (type === 0x80 || (type === 0x90 && value === 0)) {
        if (activeNote !== null) {
            eventBus.emit({
                type: "noteoff",
                source: "touchme",
                channel: 0,
                note: activeNote
            });

            activeNote = null;
        }

        applySignal(0, data);
    }
}

async function connect() {
    if (!navigator.requestMIDIAccess) {
        ui.status.textContent = "WEB MIDI INDISPONIBLE";
        return;
    }

    ui.status.textContent = "RECHERCHE MIDI…";

    try {
        midi = await navigator.requestMIDIAccess();
        refreshInputs();
        midi.onstatechange = refreshInputs;

        if (!input) {
            ui.status.textContent =
                "TOUCHEZ LE CAPTEUR POUR IDENTIFIER LE SIGNAL";
        }
    } catch (error) {
        ui.status.textContent =
            error.name === "NotAllowedError"
                ? "ACCÈS MIDI REFUSÉ"
                : "MIDI INDISPONIBLE";

        console.error("[MIDI]", error);
    }
}

function refreshInputs() {
    if (!midi) return;

    const ports = [...midi.inputs.values()];

    if (input) {
        input.onmidimessage = null;
    }

    input =
        ports.find(port =>
            /touch|playtron|playtronica/i.test(port.name || "")
        ) ||
        ports[0] ||
        null;

    if (input) {
        input.onmidimessage = handleMidi;
        ui.device.textContent =
            (input.name || "TOUCHME").toUpperCase();
        ui.status.textContent =
            "CAPTEUR CONNECTÉ · EN ATTENTE";
        ui.led.classList.add("on");
    } else {
        ui.device.textContent = "AUCUN APPAREIL";
        ui.status.textContent = "CONNECTEZ LE TOUCHME";
        ui.led.classList.remove("on");
    }
}

async function enableAudio() {
    if (started) {
        await audio.resume();
        return;
    }

    const AudioContext =
        window.AudioContext || window.webkitAudioContext;

    if (!AudioContext) {
        ui.status.textContent = "WEB AUDIO INDISPONIBLE";
        return;
    }

    audio = new AudioContext();

    osc = audio.createOscillator();
    gain = audio.createGain();
    filter = audio.createBiquadFilter();

    osc.type = "sine";
    osc.frequency.value = 110;

    filter.type = "lowpass";
    filter.frequency.value = 1200;

    gain.gain.value = 0;

    osc
        .connect(filter)
        .connect(gain)
        .connect(audio.destination);

    osc.start();
    started = true;

    ui.audio.textContent = "AUDIO ACTIVÉ";
    ui.status.textContent =
        input
            ? "CAPTEUR CONNECTÉ · AUDIO ACTIF"
            : "AUDIO ACTIF · CONNECTEZ LE CAPTEUR";

    renderSignal();
}

ui.connect.addEventListener("click", connect);
ui.audio.addEventListener("click", enableAudio);

ui.sensitivity.addEventListener("input", () => {
    ui.sensOut.textContent =
        Number(ui.sensitivity.value).toFixed(1) + "×";

    emitTouchNote();
    renderSignal();
});

ui.scale.addEventListener("change", () => {
    eventBus.emit({
        type: "scalechange",
        index: Number(ui.scale.value)
    });

    if (activeNote !== null) {
        eventBus.emit({
            type: "noteoff",
            source: "touchme",
            channel: 0,
            note: activeNote
        });

        activeNote = null;
    }

    emitTouchNote();
    renderSignal();
});

document.addEventListener("visibilitychange", () => {
    if (
        document.hidden &&
        gain &&
        audio
    ) {
        gain.gain.setTargetAtTime(
            0,
            audio.currentTime,
            0.03
        );
    }
});

function frame() {
    const now = performance.now();

    if (
        lastSignalAt &&
        now - lastSignalAt > 180
    ) {
        smoothed *= 0.985;

        if (smoothed < 0.002) {
            smoothed = 0;
        }

        if (
            activeNote !== null &&
            smoothed < 0.025
        ) {
            emitTouchNote(true);
        } else {
            emitTouchNote();
        }

        renderSignal();
    }

    raf = requestAnimationFrame(frame);
}

visualEngine.start();
renderSignal();
frame();

console.log("[TOUCHME] Corps Célestes initialisé.");
