const VERSION =
    new URL(import.meta.url).searchParams.get("v") || "runtime";

console.log("[AUDIO ENGINE] Loaded version:", VERSION);

const voiceModule =
    await import(`./voice.js?v=${VERSION}`);

const { Voice } = voiceModule;

const sampleModule = await import(
    `./string-samples.js?v=${VERSION}`
);

const { loadStringSamples } = sampleModule;

export class AudioEngine {

    constructor(eventBus) {
        this.eventBus = eventBus;
        this.audioContext = null;
        this.masterGain = null;
        this.compressor = null;
        this.limiter = null;
        this.reverbInput = null;
        this.reverb = null;
        this.reverbGain = null;
        this.reverbCompressor = null;
        this.delayInput = null;
        this.delayNode = null;
        this.delayFeedback = null;
        this.delayGain = null;
        this.delayCompressor = null;
        this.echoInput = null;
        this.echoNode = null;
        this.echoFeedback = null;
        this.echoGain = null;
        this.echoCompressor = null;
        this.activeVoices = new Map();
        this.pendingNotes = new Map();
        this.maxVoices = 5;
        this.started = false;
        this.volume = 0.5;
        this.reverbAmount = 0;
        this.delayAmount = 0;
        this.echoAmount = 0;
        this.instrument = "synth";

        this.handleEvent = this.handleEvent.bind(this);
        this.handleUserGesture = this.handleUserGesture.bind(this);

        document.addEventListener("pointerdown", this.handleUserGesture, { passive: true });
        document.addEventListener("keydown", this.handleUserGesture, { passive: true });

        eventBus.on("noteon", this.handleEvent);
        eventBus.on("noteoff", this.handleEvent);

        this.handleWindowBlur = () => this.panic();
        this.handleVisibilityChange = () => {
            if (document.visibilityState !== "visible") this.panic();
        };

        window.addEventListener("blur", this.handleWindowBlur);
        document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }

    setInstrument(value) {
        const allowed = ["synth", "strings", "harp", "piano", "vibraphone", "celesta"];
        this.instrument = allowed.includes(value) ? value : "synth";

        if (this.instrument === "strings" && this.audioContext) {
            loadStringSamples(this.audioContext).catch(error => {
                console.warn("[STRINGS] Could not preload samples:", error);
            });
        }
    }



    setVolume(value) {
        const numeric = Number(value);
        // The UI is already a 0..1 control. Do not amplify the master bus:
        // mapping 50% to +6 dB was the main source of persistent clipping.
        this.volume = Number.isFinite(numeric)
            ? Math.max(0, Math.min(1, numeric))
            : 0.5;

        if (this.masterGain && this.audioContext) {
            const now = this.audioContext.currentTime;
            this.masterGain.gain.cancelScheduledValues(now);
            this.masterGain.gain.setTargetAtTime(this.volume, now, 0.02);
        }
    }

    setReverb(value) {
        this.reverbAmount = Math.max(0, Math.min(2, (Number(value) || 0) * 2));
        if (this.reverbGain && this.audioContext) {
            this.reverbGain.gain.setTargetAtTime(
                this.reverbAmount,
                this.audioContext.currentTime,
                0.025
            );
        }
    }

    setDelay(value) {
        this.delayAmount = Math.max(0, Math.min(1, Number(value) || 0));
        if (this.delayGain && this.audioContext) {
            this.delayGain.gain.setTargetAtTime(
                this.delayAmount * 1.0,
                this.audioContext.currentTime,
                0.025
            );
        }
    }

    setEcho(value) {
        this.echoAmount = Math.max(0, Math.min(1, Number(value) || 0));
        if (this.echoGain && this.audioContext) {
            this.echoGain.gain.setTargetAtTime(
                this.echoAmount * 0.9,
                this.audioContext.currentTime,
                0.025
            );
        }
    }

    async handleUserGesture() {
        if (this.started) return;
        try {
            await this.start();
        } catch (error) {
            console.warn("[AUDIO] User gesture could not unlock audio:", error);
        }
    }

    async start() {
        if (!this.audioContext) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) throw new Error("Web Audio API indisponible.");

            this.audioContext = new AudioContext();
            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = this.volume;

            this.compressor = this.audioContext.createDynamicsCompressor();
            this.compressor.threshold.value = -16;
            this.compressor.knee.value = 18;
            this.compressor.ratio.value = 2.5;
            this.compressor.attack.value = 0.012;
            this.compressor.release.value = 0.18;

            // Final safety stage: the instrument voices and effect returns can
            // legitimately sum above 0 dBFS, especially on dense chords.
            // Keep the musical dynamics in the compressor, then hard-limit
            // only the final bus so individual instruments cannot clip.
            this.limiter = this.audioContext.createDynamicsCompressor();
            this.limiter.threshold.value = -6;
            this.limiter.knee.value = 0;
            this.limiter.ratio.value = 100;
            this.limiter.attack.value = 0.001;
            this.limiter.release.value = 0.08;

            this.createReverb();
            this.createDelayEffects();

            this.masterGain.connect(this.compressor);
            this.compressor.connect(this.limiter);
            this.limiter.connect(this.audioContext.destination);
        }

        if (this.audioContext.state === "suspended") {
            await this.audioContext.resume();
        }

        if (this.audioContext.state !== "running") {
            throw new Error(`AudioContext state: ${this.audioContext.state}`);
        }

        this.started = true;

        // Warm the acoustic string buffers in the background. Do not await this:
        // the AudioContext must become usable immediately and noteOn must not
        // be delayed by network or decode work.
        loadStringSamples(this.audioContext).catch(error => {
            console.warn("[AUDIO] String sample preload failed:", error);
        });
    }

    createReverb() {
        const context = this.audioContext;
        this.reverbInput = context.createGain();

        const duration = 2.8;
        const decay = 5.5;
        const sampleRate = context.sampleRate;
        const length = Math.floor(sampleRate * duration);
        const impulse = context.createBuffer(2, length, sampleRate);

        for (let channel = 0; channel < 2; channel++) {
            const data = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                const time = i / sampleRate;
                const envelope = Math.pow(1 - time / duration, decay);
                const noise = Math.random() * 2 - 1;
                const stereo = channel === 0 ? 1 : 0.92;
                data[i] = noise * envelope * stereo;
            }
        }

        this.reverb = context.createConvolver();
        this.reverb.buffer = impulse;
        this.reverbGain = context.createGain();
        this.reverbGain.gain.value = this.reverbAmount;

        // Keep dense reverb returns from creating large instantaneous peaks.
        // This does not change the reverb control range; it only catches the
        // summed return before it reaches the master bus.
        this.reverbCompressor = context.createDynamicsCompressor();
        this.reverbCompressor.threshold.value = -10;
        this.reverbCompressor.knee.value = 12;
        this.reverbCompressor.ratio.value = 4;
        this.reverbCompressor.attack.value = 0.002;
        this.reverbCompressor.release.value = 0.18;

        const reverbFilter = context.createBiquadFilter();
        reverbFilter.type = "lowpass";
        reverbFilter.frequency.value = 2600;
        reverbFilter.Q.value = 0.2;

        this.reverbInput.connect(this.reverb);
        this.reverb.connect(reverbFilter);
        reverbFilter.connect(this.reverbGain);
        this.reverbGain.connect(this.reverbCompressor);
        this.reverbCompressor.connect(this.masterGain);
    }

    createDelayEffects() {
        const context = this.audioContext;

        this.delayInput = context.createGain();
        this.delayNode = context.createDelay(1);
        this.delayFeedback = context.createGain();
        this.delayGain = context.createGain();
        this.delayCompressor = context.createDynamicsCompressor();
        this.delayCompressor.threshold.value = -10;
        this.delayCompressor.knee.value = 12;
        this.delayCompressor.ratio.value = 4;
        this.delayCompressor.attack.value = 0.002;
        this.delayCompressor.release.value = 0.18;

        this.delayNode.delayTime.value = 0.24;
        this.delayFeedback.gain.value = 0.42;
        this.delayGain.gain.value = this.delayAmount;

        this.delayInput.connect(this.delayNode);
        this.delayNode.connect(this.delayFeedback);
        this.delayFeedback.connect(this.delayNode);
        this.delayNode.connect(this.delayGain);
        this.delayGain.connect(this.delayCompressor);
        this.delayCompressor.connect(this.masterGain);

        this.echoInput = context.createGain();
        this.echoNode = context.createDelay(1);
        this.echoFeedback = context.createGain();
        this.echoGain = context.createGain();
        this.echoCompressor = context.createDynamicsCompressor();
        this.echoCompressor.threshold.value = -10;
        this.echoCompressor.knee.value = 12;
        this.echoCompressor.ratio.value = 4;
        this.echoCompressor.attack.value = 0.002;
        this.echoCompressor.release.value = 0.18;

        this.echoNode.delayTime.value = 0.52;
        this.echoFeedback.gain.value = 0.5;
        this.echoGain.gain.value = this.echoAmount * 0.9;

        this.echoInput.connect(this.echoNode);
        this.echoNode.connect(this.echoFeedback);
        this.echoFeedback.connect(this.echoNode);
        this.echoNode.connect(this.echoGain);
        this.echoGain.connect(this.echoCompressor);
        this.echoCompressor.connect(this.masterGain);


    }

    handleEvent(event) {
        if (!event || !Number.isFinite(event.note)) return;
        if (event.type !== "noteon" && event.type !== "noteoff") return;

        const pendingKey =
            `${event.source}-${event.channel}-${Number.isFinite(event.rawNote) ? event.rawNote : event.note}`;

        if (!this.started) {
            if (event.type === "noteon") this.pendingNotes.set(pendingKey, event);
            else this.pendingNotes.delete(pendingKey);

            this.start().then(() => {
                for (const [key, pendingEvent] of this.pendingNotes) {
                    this.pendingNotes.delete(key);
                    if (pendingEvent.type === "noteon") {
                        this.noteOn(pendingEvent);
                    }
                }
            }).catch(error => {
                console.warn("[AUDIO] Waiting for user interaction:", error);
            });
            return;
        }

        if (event.type === "noteon") this.noteOn(event);
        if (event.type === "noteoff") this.noteOff(event);
    }

    noteOn(event, forcedVoiceId = null) {
        if (!this.audioContext || !this.masterGain) return;

        const audioNote = event.note;
        const voiceKey = Number.isFinite(event.rawNote) ? event.rawNote : event.note;
        const voiceId = forcedVoiceId || (event.source + "-" + event.channel + "-" + voiceKey);

        if (this.activeVoices.has(voiceId)) return;

        if (this.activeVoices.size >= this.maxVoices) {
            const oldestId = this.activeVoices.keys().next().value;
            const oldestVoice = this.activeVoices.get(oldestId);
            if (oldestVoice) {
                try { oldestVoice.release(); }
                catch (error) { console.warn("[AUDIO] Voice limit recovery:", error); }
            }
            this.activeVoices.delete(oldestId);
        }

        const velocity = Math.max(0, Math.min(1,
            Number.isFinite(event.velocity) ? event.velocity : 1
        ));

        const voice = new Voice(
            this.audioContext,
            this.masterGain,
            this.reverbInput,
            this.delayInput,
            this.echoInput,
            {
                note: audioNote,
                velocity,
                chord: Boolean(event.chord),
                chordIntervals: event.chordIntervals
            }
        );

        voice.setInstrument(this.instrument);

        this.activeVoices.set(voiceId, voice);
        Promise.resolve(voice.start()).catch(error => {
            console.warn("[AUDIO] Voice start failed:", error);
            try { voice.disconnect(); } catch {}
            if (this.activeVoices.get(voiceId) === voice) {
                this.activeVoices.delete(voiceId);
                this.updateSystemState();
            }
        });
        this.updateSystemState();
    }

    updateSystemState() {
        const voices = [...this.activeVoices.values()];
        const count = voices.length;

        for (const voice of voices) {
            let nearestDistance = Infinity;
            for (const other of voices) {
                if (other === voice) continue;
                nearestDistance = Math.min(nearestDistance, Math.abs(other.note - voice.note));
            }
            voice.setSystemState({
                count,
                nearestDistance: Number.isFinite(nearestDistance) ? nearestDistance : null
            });
        }
    }

    noteOff(event) {
        const voiceKey = Number.isFinite(event.rawNote) ? event.rawNote : event.note;
        const voiceId = `${event.source}-${event.channel}-${voiceKey}`;
        const voice = this.activeVoices.get(voiceId);
        if (!voice) return;

        // Mobile glides can cross notes rapidly. Use the short forced release
        // for touch handoffs so old tails do not accumulate and glitch.
        voice.release(event.source === "touch");
        this.activeVoices.delete(voiceId);
        this.updateSystemState();
    }

    panic() {
        this.pendingNotes.clear();
        for (const voice of this.activeVoices.values()) {
            try { voice.release(true); }
            catch (error) { console.warn("[AUDIO] Panic release:", error); }
        }
        this.activeVoices.clear();
    }

    async resume() {
        if (!this.audioContext) return;
        if (this.audioContext.state === "suspended") await this.audioContext.resume();
    }
}
