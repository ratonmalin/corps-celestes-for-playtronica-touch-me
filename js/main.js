import { EventBus } from "./core/event-bus.js";
import { AudioEngine } from "./audio/audio.js?v=20261002-11";
import { VisualEngine } from "./visuals/visual-engine.js";
import { TouchMeMidiInput } from "./input/touchme-midi.js";

const $ = id => document.getElementById(id);

const ui = {
    fullscreen: $("fullscreen"),
    status: $("status"),
    device: $("device"),
    led: $("led"),
    cc: $("cc-value"),
    freq: $("freq"),
    sensitivity: $("sensitivity"),
    sensOut: $("sens-out"),
    volume: $("volume"),
    volumeOut: $("volume-out"),
    scale: $("scale"),
    knobs: [...document.querySelectorAll(".effect-knob")]
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
    ui.led.classList.toggle("on", connected || intensity > 0.01);
}

function updateKnob(knob, value) {
    const normalized = clamp(value);
    const circle = knob.querySelector(".effect-arc");
    if (!circle) return;

    const circumference = 2 * Math.PI * 15;
    const arcLength = circumference * 0.75;
    circle.style.strokeDasharray = `${arcLength * normalized} ${circumference}`;
    circle.style.strokeDashoffset = "0";
    knob.setAttribute("aria-valuenow", normalized.toFixed(3));
}

function setEffectFromPointer(knob, event) {
    const rect = knob.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const angle = Math.atan2(event.clientY - cy, event.clientX - cx) * 180 / Math.PI;
    let relativeAngle = angle + 135;
    if (relativeAngle < 0) relativeAngle += 360;
    let normalized = relativeAngle / 270;
    normalized = clamp(normalized);
    const type = knob.dataset.effect;
    knob.dataset.value = normalized.toFixed(3);
    updateKnob(knob, normalized);

    if (type === "reverb") audio.setReverb(normalized);
    if (type === "delay") audio.setDelay(normalized);
    if (type === "echo") audio.setEcho(normalized);
}

for (const knob of ui.knobs) {
    const initial = Number(knob.dataset.value) || 0;
    updateKnob(knob, initial);

    knob.addEventListener("pointerdown", event => {
        knob.setPointerCapture(event.pointerId);
        setEffectFromPointer(knob, event);
    });

    knob.addEventListener("pointermove", event => {
        if (knob.hasPointerCapture(event.pointerId)) {
            setEffectFromPointer(knob, event);
        }
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
    setStatus("INITIALISATION");

    midi = new TouchMeMidiInput(eventBus, event => {
        if (event.type === "connected") {
            connected = true;
            ui.device.textContent = String(event.device || "TOUCHME").toUpperCase();
            setStatus("CAPTEUR CONNECTÉ · EN ATTENTE");
            renderSignal();
            return;
        }
        if (event.type === "status") {
            if (!connected) setStatus(event.status);
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
