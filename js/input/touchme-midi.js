export class TouchMeMidiInput {
    constructor(eventBus, onSignal = null) {
        this.eventBus = eventBus;
        this.onSignal = onSignal;
        this.access = null;
        this.input = null;
        this.lastIntensity = new Map();
        this.activeNotes = new Map();
        this.lastControllerValue = null;
        this.sensitivity = 1;
        this.visibilityHandler = null;

        this.handleMessage = this.handleMessage.bind(this);
        this.handleStateChange = this.handleStateChange.bind(this);
        this.releaseAll = this.releaseAll.bind(this);
    }

    setSensitivity(value) {
        const numeric = Number(value);
        this.sensitivity = Number.isFinite(numeric)
            ? Math.max(0.25, Math.min(3, numeric))
            : 1;
    }

    async start() {
        if (!navigator.requestMIDIAccess) {
            this.onSignal?.({
                type: "status",
                status: "WEB MIDI INDISPONIBLE"
            });
            return;
        }

        try {
            this.access = await navigator.requestMIDIAccess();
            this.access.onstatechange = this.handleStateChange;

            this.visibilityHandler = () => {
                if (document.visibilityState !== "visible") {
                    this.releaseAll();
                }
            };

            document.addEventListener(
                "visibilitychange",
                this.visibilityHandler
            );
            window.addEventListener("blur", this.releaseAll);

            this.refreshInput();
        } catch (error) {
            this.onSignal?.({
                type: "status",
                status:
                    error?.name === "NotAllowedError"
                        ? "ACCÈS MIDI REFUSÉ"
                        : "MIDI INDISPONIBLE"
            });

            console.warn("[TOUCHME MIDI]", error);
        }
    }

    refreshInput() {
        if (!this.access) return;

        if (this.input) {
            this.input.onmidimessage = null;
        }

        const inputs = [...this.access.inputs.values()];

        this.input =
            inputs.find(port =>
                /touchme|playtronica/i.test(
                    String(port.name || "") +
                    " " +
                    String(port.manufacturer || "")
                )
            ) || null;

        if (!this.input) {
            this.onSignal?.({
                type: "status",
                status: "TOUCHME EN ATTENTE"
            });
            return;
        }

        this.input.onmidimessage = this.handleMessage;

        this.onSignal?.({
            type: "connected",
            device: this.input.name || "TOUCHME"
        });
    }

    handleStateChange(event) {
        if (
            event?.port?.type === "input" &&
            event.port.state === "disconnected"
        ) {
            this.releaseAll();
            this.input = null;
        }

        this.refreshInput();
    }

    handleMessage(message) {
        if (!message?.data || message.data.length < 3) return;

        const [status, data1, data2] = message.data;
        const type = status & 0xf0;
        const channel = status & 0x0f;

        if (type === 0xb0 && data1 === 90) {
            const value = data2 / 127;

            this.lastIntensity.set(channel, value);
            this.lastControllerValue = data2;

            this.onSignal?.({
                type: "intensity",
                value: clamp01(value * this.sensitivity),
                controller: 90,
                channel
            });

            return;
        }

        if (type === 0x90 && data2 > 0) {
            const raw = this.lastIntensity.get(channel);
            const value = clamp01(
                (raw ?? data2 / 127) * this.sensitivity
            );

            const key = channel + "-" + data1;

            this.activeNotes.set(key, {
                note: data1,
                channel
            });

            this.eventBus.emit({
                type: "noteon",
                note: data1,
                velocity: Math.max(0.05, value),
                channel,
                source: "touchme",
                timestamp: performance.now(),
                touchIntensity: value
            });

            this.onSignal?.({
                type: "note",
                value,
                note: data1,
                channel
            });

            return;
        }

        if (type === 0x80 || (type === 0x90 && data2 === 0)) {
            this.activeNotes.delete(channel + "-" + data1);

            this.eventBus.emit({
                type: "noteoff",
                note: data1,
                velocity: 0,
                channel,
                source: "touchme",
                timestamp: performance.now()
            });
        }
    }

    releaseAll() {
        if (!this.activeNotes.size) return;

        const active = [...this.activeNotes.values()];
        this.activeNotes.clear();

        for (const { note, channel } of active) {
            this.eventBus.emit({
                type: "noteoff",
                note,
                velocity: 0,
                channel,
                source: "touchme",
                timestamp: performance.now()
            });
        }
    }
}

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}
