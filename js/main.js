import { EventBus } from "./core/event-bus.js";
import { AudioEngine } from "./audio/audio.js";
import { VisualEngine } from "./visuals/visual-engine.js";
import { TouchMeMidiInput } from "./input/touchme-midi.js";

const $ = id => document.getElementById(id);
const ui = {
    connect: $("connect"), audio: $("audio"), status: $("status"), device: $("device"),
    led: $("led"), level: $("level"), cc: $("cc-value"), ccMeter: $("cc-meter"),
    freq: $("freq"), freqMeter: $("freq-meter"), sensitivity: $("sensitivity"),
    sensOut: $("sens-out"), scale: $("scale"), planet: $("planet")
};

const eventBus = new EventBus();
const visualEngine = new VisualEngine(eventBus);
const audioEngine = new AudioEngine(eventBus);
let midi = null;
let connected = false;
let filteredIntensity = 0;
let lastIntensityAt = 0;

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
function frequencyForNote(note) {
    if (!Number.isFinite(note)) return 0;
    return 440 * Math.pow(2, (note - 69) / 12);
}
function renderSignal(note = null) {
    const sensitivity = Number(ui.sensitivity.value) || 1;
    const effective = clamp(filteredIntensity * sensitivity);
    ui.level.innerHTML = Math.round(effective * 100) + "<span>%</span>";
    ui.cc.textContent = midi?.lastControllerValue == null ? "090" : String(Math.round(midi.lastControllerValue)).padStart(3, "0");
    ui.ccMeter.style.width = effective * 100 + "%";
    const frequency = frequencyForNote(note);
    if (frequency > 0) {
        ui.freq.textContent = Math.round(frequency) + " Hz";
        ui.freqMeter.style.width = clamp((frequency - 60) / 1000) * 100 + "%";
    }
    ui.planet.style.filter = "brightness(" + (1 + effective * 0.65) + ") saturate(" + (1 + effective * 0.8) + ")";
    ui.planet.style.transform = "scale(" + (1 + effective * 0.07) + ")";
    ui.led.classList.toggle("on", connected || effective > 0.015);
}
function handleSignal(event) {
    if (!event) return;
    if (event.type === "connected") {
        connected = true;
        ui.device.textContent = String(event.device).toUpperCase();
        ui.status.textContent = "CAPTEUR CONNECTÉ · EN ATTENTE";
        ui.led.classList.add("on");
        return;
    }
    if (event.type === "status") { ui.status.textContent = event.status; return; }
    if (event.type === "intensity" || event.type === "note") {
        filteredIntensity += (clamp(event.value) - filteredIntensity) * (event.type === "note" ? 0.5 : 0.28);
        lastIntensityAt = performance.now();
        renderSignal(event.note ?? null);
    }
}
async function connect() {
    if (!midi) {
        midi = new TouchMeMidiInput(eventBus, handleSignal);
        await midi.start();
    }
    if (midi.input) { connected = true; ui.status.textContent = "CAPTEUR CONNECTÉ · EN ATTENTE"; }
}
async function enableAudio() {
    try {
        await audioEngine.start();
        ui.audio.textContent = "AUDIO ACTIVÉ";
        ui.status.textContent = connected ? "CAPTEUR CONNECTÉ · AUDIO ACTIF" : "AUDIO ACTIF · CONNECTEZ LE CAPTEUR";
    } catch (error) {
        ui.status.textContent = "WEB AUDIO INDISPONIBLE";
        console.warn("[AUDIO]", error);
    }
}
ui.connect.addEventListener("click", connect);
ui.audio.addEventListener("click", enableAudio);
ui.sensitivity.addEventListener("input", () => {
    ui.sensOut.textContent = Number(ui.sensitivity.value).toFixed(1) + "×";
    renderSignal();
});
ui.scale.addEventListener("change", () => {
    eventBus.emit({ type: "scalechange", index: Number(ui.scale.value) });
    ui.status.textContent = connected ? "CAPTEUR CONNECTÉ · EN ATTENTE" : "EN ATTENTE DU TOUCHME";
});
eventBus.on("noteon", event => {
    const value = Number.isFinite(event.touchIntensity) ? event.touchIntensity : event.velocity;
    filteredIntensity += (clamp(value) - filteredIntensity) * 0.5;
    lastIntensityAt = performance.now();
    renderSignal(event.note);
});
eventBus.on("noteoff", () => { lastIntensityAt = performance.now(); renderSignal(); });
function decay() {
    const now = performance.now();
    if (lastIntensityAt && now - lastIntensityAt > 120) {
        filteredIntensity *= 0.985;
        if (filteredIntensity < 0.002) filteredIntensity = 0;
        renderSignal();
    }
    requestAnimationFrame(decay);
}
visualEngine.start();
ui.sensOut.textContent = Number(ui.sensitivity.value).toFixed(1) + "×";
eventBus.emit({ type: "scalechange", index: Number(ui.scale.value || 0) });
ui.led.classList.remove("on");
renderSignal();
decay();
console.log("[TOUCHME] Corps Célestes — moteur original chargé.");