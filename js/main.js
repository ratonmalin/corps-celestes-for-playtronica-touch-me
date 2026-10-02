import { EventBus } from "./core/event-bus.js";
import { AudioEngine } from "./audio/audio.js?v=20261002-37";
import { VisualEngine } from "./visuals/visual-engine.js?v=20261002-45";
import { TouchMeMidiInput } from "./input/touchme-midi.js";

const $ = id => document.getElementById(id);

const ui = {
    fullscreen: $("fullscreen"),
    status: $("status"),
    led: $("led"),
    cc: $("cc-value"),
    freq: $("freq"),
    sensitivity: $("sensitivity"),
    sensOut: $("sens-out"),
    volume: $("volume"),
    volumeOut: $("volume-out"),
    scale: $("scale"),
    effects: [...document.querySelectorAll(".effect-slider")],
    instrument: $("instrument"),
};

const eventBus = new EventBus();
const audio = new AudioEngine(eventBus);
const visuals = new VisualEngine(eventBus);

let midi = null;
let connected = false;
let intensity = 0;

const clamp = (value, min = 0, max = 1) =>
    Math.max(min, Math.min(max, value));

function noteFrequency(note) {
    return Number.isFinite(note)
        ? 440 * Math.pow(2, (note - 69) / 12)
        : 0;
}

function setStatus(text) {
    ui.status.textContent = text;
}

function renderSignal(note = null) {
    const frequency = noteFrequency(note);

    ui.cc.textContent =
        midi?.lastControllerValue == null
            ? "090"
            : String(Math.round(midi.lastControllerValue)).padStart(3, "0");

    if (frequency > 0) ui.freq.textContent = Math.round(frequency) + " Hz";
    ui.led.classList.toggle("on", connected);
}

const INSTRUMENTS = [
    ["synth", "INSTRUMENT · SYNTHÉTIQUE"],
    ["strings", "INSTRUMENT · CORDES"],
    ["harp", "INSTRUMENT · HARPE"],
    ["piano", "INSTRUMENT · PIANO FEUTRÉ"],
    ["vibraphone", "INSTRUMENT · VIBRAPHONE"],
    ["celesta", "INSTRUMENT · CÉLESTA"]
];

let instrumentIndex = 0;

function setInstrument(value) {
    const index = INSTRUMENTS.findIndex(([id]) => id === value);
    instrumentIndex = index >= 0 ? index : 0;
    const [id, label] = INSTRUMENTS[instrumentIndex];

    audio.setInstrument(id);
    ui.instrument.textContent = label;
    ui.instrument.dataset.instrument = id;
}

function setEffect(type, value, output) {
    const normalized = clamp(Number(value));
    output.textContent = Math.round(normalized * 100) + "%";

    if (type === "reverb") audio.setReverb(normalized);
    if (type === "delay") audio.setDelay(normalized);
    if (type === "echo") audio.setEcho(normalized);
}

ui.instrument.addEventListener("click", () => {
    instrumentIndex = (instrumentIndex + 1) % INSTRUMENTS.length;
    setInstrument(INSTRUMENTS[instrumentIndex][0]);
});


setInstrument("synth");

for (const slider of ui.effects) {
    const type = slider.querySelector('input[type="range"]');
    const output = slider.querySelector(".effect-value");

    if (!type || !output) continue;

    setEffect(type.dataset.effect, type.value, output);

    type.addEventListener("input", () => {
        setEffect(type.dataset.effect, type.value, output);
    });
}

ui.fullscreen.addEventListener("click", async () => {
    try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else {
            await audio.start();
            await document.documentElement.requestFullscreen();
        }
    } catch (error) {
        console.warn("[FULLSCREEN]", error);
        setStatus("PLEIN ÉCRAN INDISPONIBLE");
    }
});

document.addEventListener("fullscreenchange", () => {
    ui.fullscreen.textContent = document.fullscreenElement ? "QUITTER" : "FULL SCREEN";
});

ui.volume.addEventListener("input", () => {
    const value = Number(ui.volume.value);
    audio.setVolume(value);
    ui.volumeOut.textContent = Math.round(value * 100) + "%";
});

ui.sensitivity.addEventListener("input", () => {
    const value = Number(ui.sensitivity.value);
    ui.sensOut.textContent = value.toFixed(1) + "×";
    midi?.setSensitivity(value);
});

ui.scale.addEventListener("change", async () => {
    try { await audio.start(); }
    catch (error) { console.info("[AUDIO] En attente d'un geste utilisateur.", error); }

    const index = Number(ui.scale.value);
    midi?.setScale(index);
    eventBus.emit({ type: "scalechange", index });
});

eventBus.on("noteon", event => {
    const value = Number.isFinite(event.touchIntensity) ? event.touchIntensity : event.velocity;
    intensity = clamp(value);
    renderSignal(event.note);
});

eventBus.on("noteoff", () => {
    intensity *= 0.92;
    renderSignal();
});

function decay() {
    intensity *= 0.985;
    if (intensity < 0.002) intensity = 0;
    renderSignal();
    requestAnimationFrame(decay);
}

function resetVolume() {
    const value = 0.5;
    ui.volume.value = String(value);
    ui.volumeOut.textContent = "50%";
    audio.setVolume(value);
}

window.addEventListener("pageshow", resetVolume);

async function boot() {
    resetVolume();
    const sensitivity = Number(ui.sensitivity.value) || 1;
    ui.sensOut.textContent = sensitivity.toFixed(1) + "×";

    visuals.start();
    decay();
    setStatus("");

    midi = new TouchMeMidiInput(eventBus, event => {
        if (event.type === "connected") {
            connected = true;
            setStatus("CAPTEUR CONNECTÉ");
            renderSignal();
            return;
        }
        if (event.type === "status") {
            connected = false;
            setStatus("");
            ui.led.classList.remove("on");
            return;
        }
        if (event.type === "intensity" || event.type === "note") {
            intensity = clamp(event.value);
            renderSignal(event.note);
        }
    });

    midi.setSensitivity(sensitivity);
    midi.setScale(Number(ui.scale.value) || 0);
    await midi.start();

    const retry = () => {
        if (!midi.input) {
            midi.refreshInput();
            window.setTimeout(retry, 1000);
        }
    };
    retry();
}

boot().catch(error => {
    console.warn("[BOOT]", error);
    setStatus("INITIALISATION IMPOSSIBLE");
});
