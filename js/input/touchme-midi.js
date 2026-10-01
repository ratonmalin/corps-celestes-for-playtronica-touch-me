export class TouchMeMidiInput {
    constructor(eventBus, onSignal = null) {
        this.eventBus = eventBus;
        this.onSignal = onSignal;
        this.access = null;
        this.input = null;
        this.lastIntensity = new Map();
        this.activeNotes = new Map();
        this.lastControllerValue = null;
        this.handleMessage = this.handleMessage.bind(this);
        this.handleStateChange = this.handleStateChange.bind(this);
        this.releaseAll = this.releaseAll.bind(this);
    }
    async start() {
        if (!navigator.requestMIDIAccess) {
            this.onSignal?.({ type: "status", status: "WEB MIDI INDISPONIBLE" });
            return;
        }
        try {
            this.access = await navigator.requestMIDIAccess();
            this.refreshInput();
            this.access.onstatechange = this.handleStateChange;
            this.handleVisibilityChange = () => { if (document.visibilityState !== "visible") this.releaseAll(); };
            document.addEventListener("visibilitychange", this.handleVisibilityChange);
            window.addEventListener("blur", this.releaseAll);
        } catch (error) {
            this.onSignal?.({ type: "status", status: error?.name === "NotAllowedError" ? "ACCÈS MIDI REFUSÉ" : "MIDI INDISPONIBLE" });
            console.warn("[TOUCHME MIDI]", error);
        }
    }
    refreshInput() {
        if (!this.access) return;
        if (this.input) this.input.onmidimessage = null;
        const inputs = [...this.access.inputs.values()];
        this.input = inputs.find(port => /touchme|touch|playtronica/i.test(port.name || "")) || null;
        if (!this.input) {
            this.onSignal?.({ type: "status", status: "CONNECTEZ LE TOUCHME" });
            return;
        }
        this.input.onmidimessage = this.handleMessage;
        this.onSignal?.({ type: "connected", device: this.input.name || "TOUCHME" });
    }
    handleStateChange(event) {
        if (event?.port?.type === "input" && event.port.state === "disconnected") this.releaseAll();
        this.refreshInput();
    }
    handleMessage(message) {
        if (!message?.data || message.data.length < 3) return;
        const [status, data1, data2] = message.data;
        const type = status & 0xf0;
        const channel = status & 0x0f;
        if (type === 0xb0 && data1 === 90) {
            const intensity = data2 / 127;
            this.lastIntensity.set(channel, intensity);
            this.lastControllerValue = data2;
            this.onSignal?.({ type: "intensity", value: intensity, controller: 90, channel });
            return;
        }
        if (type === 0x90 && data2 > 0) {
            const intensity = this.lastIntensity.get(channel) ?? data2 / 127;
            const key = channel + "-" + data1;
            this.activeNotes.set(key, { note: data1, channel });
            this.eventBus.emit({ type: "noteon", note: data1, velocity: Math.max(0.05, Math.min(1, intensity)), channel, source: "touchme", timestamp: performance.now(), touchIntensity: intensity });
            this.onSignal?.({ type: "note", value: intensity, note: data1, channel });
            return;
        }
        if (type === 0x80 || (type === 0x90 && data2 === 0)) {
            this.activeNotes.delete(channel + "-" + data1);
            this.eventBus.emit({ type: "noteoff", note: data1, velocity: 0, channel, source: "touchme", timestamp: performance.now() });
        }
    }
    releaseAll() {
        if (!this.activeNotes.size) return;
        const active = [...this.activeNotes.values()];
        this.activeNotes.clear();
        for (const { note, channel } of active) this.eventBus.emit({ type: "noteoff", note, velocity: 0, channel, source: "touchme", timestamp: performance.now() });
    }
}