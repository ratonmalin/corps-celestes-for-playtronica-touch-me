import { EventBus } from "./core/event-bus.js";
import { AudioEngine } from "./audio/audio.js";
import { VisualEngine } from "./visuals/visual-engine.js";
import { TouchMeMidiInput } from "./input/touchme-midi.js";

const $ = id => document.getElementById(id);
const ui = {
    fullscreen: $("fullscreen"), status: $("status"), device: $("device"),
    led: $("led"), cc: $("cc-value"), freq: $("freq"),
    sensitivity: $("sensitivity"), sensOut: $("sens-out"),
    volume: $("volume"), volumeOut: $("volume-out"), scale: $("scale")
};

const VOLUME_STORAGE_KEY = "corps-celestes-volume-v2";

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

    ui.cc.textContent = midi?.lastControllerValue == null
        ? "090"
        : String(Math.round(midi.lastControllerValue)).padStart(3, "0");

    const frequency = frequencyForNote(note);

    if (frequency > 0) {
        ui.freq.textContent = Math.round(frequency) + " Hz";
    }

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

    if (event.type === "status") {
        ui.status.textContent = event.status;
        return;
    }

    if (event.type === "intensity" || event.type === "note") {
        filteredIntensity +=
            (clamp(event.value) - filteredIntensity) *
            (event.type === "note" ? 0.5 : 0.28);

        lastIntensityAt = performance.now();
        renderSignal(event.note ?? null);
    }
}

ui.fullscreen.addEventListener("click", async () => {
    try {
        if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
            ui.fullscreen.textContent = "QUITTER";
        } else {
            await document.exitFullscreen();
        }
    } catch (error) {
        ui.status.textContent = "PLEIN ÉCRAN INDISPONIBLE";
        console.warn("[FULLSCREEN]", error);
    }
});

document.addEventListener("fullscreenchange", () => {
    ui.fullscreen.textContent =
        document.fullscreenElement ? "QUITTER" : "FULL SCREEN";
});

ui.sensitivity.addEventListener("input", () => {
    const value = Number(ui.sensitivity.value);
    ui.sensOut.textContent = value.toFixed(1) + "×";

    if (midi) midi.setSensitivity(value);
    renderSignal();
});

ui.volume.addEventListener("input", () => {
    const value = Number(ui.volume.value);
    ui.volumeOut.textContent = Math.round(value * 100) + "%";
    audioEngine.setVolume(value);
    localStorage.setItem(VOLUME_STORAGE_KEY, String(value));
});

ui.volume.addEventListener("change", () => {
    audioEngine.setVolume(Number(ui.volume.value));
});

ui.scale.addEventListener("change", () => {
    eventBus.emit({
        type: "scalechange",
        index: Number(ui.scale.value)
    });

    ui.status.textContent = connected
        ? "CAPTEUR CONNECTÉ · EN ATTENTE"
        : "EN ATTENTE DU TOUCHME";
});

eventBus.on("noteon", event => {
    const value = Number.isFinite(event.touchIntensity)
        ? event.touchIntensity
        : event.velocity;

    filteredIntensity +=
        (clamp(value) - filteredIntensity) * 0.5;

    lastIntensityAt = performance.now();
    renderSignal(event.note);
});

eventBus.on("noteoff", () => {
    lastIntensityAt = performance.now();
    renderSignal();
});

function decay() {
    const now = performance.now();

    if (lastIntensityAt && now - lastIntensityAt > 120) {
        filteredIntensity *= 0.985;

        if (filteredIntensity < 0.002) filteredIntensity = 0;
        renderSignal();
    }

    requestAnimationFrame(decay);
}

async function boot() {
    const storedVolume = localStorage.getItem(VOLUME_STORAGE_KEY);
    const savedVolume = storedVolume === null ? NaN : Number(storedVolume);

    if (Number.isFinite(savedVolume)) {
        ui.volume.value = String(clamp(savedVolume));
    }

    const volume = Number(ui.volume.value);
    ui.volumeOut.textContent = Math.round(volume * 100) + "%";
    audioEngine.setVolume(volume);

    const sensitivity = Number(ui.sensitivity.value) || 1;
    ui.sensOut.textContent = sensitivity.toFixed(1) + "×";

    visualEngine.start();

    eventBus.emit({
        type: "scalechange",
        index: Number(ui.scale.value || 0)
    });

    ui.led.classList.remove("on");
    ui.status.textContent = "INITIALISATION";
    renderSignal();
    decay();

    audioEngine.start().catch(error => {
        console.warn("[AUDIO] Autostart impossible:", error);
    });

    midi = new TouchMeMidiInput(eventBus, handleSignal);
    midi.setSensitivity(sensitivity);
    await midi.start();

    const waitForTouchMe = () => {
        if (!midi?.input) midi.refreshInput();

        if (midi?.input) {
            connected = true;
            ui.status.textContent = "CAPTEUR CONNECTÉ · EN ATTENTE";
            ui.device.textContent =
                String(midi.input.name || "TOUCHME").toUpperCase();
            ui.led.classList.add("on");
            return;
        }

        ui.status.textContent = "RECHERCHE DU TOUCHME";
        window.setTimeout(waitForTouchMe, 750);
    };

    waitForTouchMe();

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            audioEngine.resume().catch(() => {});
            waitForTouchMe();
        }
    });
}

boot().catch(error => {
    ui.status.textContent = "INITIALISATION IMPOSSIBLE";
    console.warn("[TOUCHME]", error);
});

console.log("[TOUCHME] Corps Célestes — initialisation automatique.");
