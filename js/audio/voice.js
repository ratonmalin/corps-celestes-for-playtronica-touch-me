export class Voice {

    constructor(
        audioContext,
        destination,
        reverbInput,
        { note, velocity }
    ) {
        this.audioContext = audioContext;
        this.destination = destination;
        this.reverbInput = reverbInput;

        this.note = note;
        this.velocity = velocity;

        this.oscillatorA = null;
        this.oscillatorB = null;
        this.oscillatorC = null;

        this.oscillatorAGain = null;
        this.oscillatorBGain = null;
        this.oscillatorCGain = null;

        this.filter = null;
        this.gain = null;
        this.reverbSend = null;
        this.panner = null;

        this.lfo = null;
        this.lfoGain = null;

        this.filterLfo = null;
        this.filterLfoGain = null;

        this.isReleased = false;
        this.releaseTimer = null;
        this.startedAt = null;
        this.maxHoldTimer = null;

        this.systemCount = 1;
        this.nearestDistance = null;
    }

    start() {
        const context = this.audioContext;
        const now = context.currentTime;
        this.startedAt = now;

        const frequency =
            440 * Math.pow(2, (this.note - 69) / 12);

        this.oscillatorA = context.createOscillator();
        this.oscillatorA.type = "triangle";
        this.oscillatorA.frequency.setValueAtTime(frequency, now);

        this.oscillatorB = context.createOscillator();
        this.oscillatorB.type = "sine";
        this.oscillatorB.frequency.setValueAtTime(frequency, now);
        this.oscillatorB.detune.setValueAtTime(-4, now);

        this.oscillatorC = context.createOscillator();
        this.oscillatorC.type = "sine";
        this.oscillatorC.frequency.setValueAtTime(frequency * 0.5, now);
        this.oscillatorC.detune.setValueAtTime(3, now);

        this.oscillatorAGain = context.createGain();
        this.oscillatorBGain = context.createGain();
        this.oscillatorCGain = context.createGain();

        this.oscillatorAGain.gain.setValueAtTime(0.52, now);
        this.oscillatorBGain.gain.setValueAtTime(0.28, now);
        this.oscillatorCGain.gain.setValueAtTime(0.20, now);

        this.oscillatorA.connect(this.oscillatorAGain);
        this.oscillatorB.connect(this.oscillatorBGain);
        this.oscillatorC.connect(this.oscillatorCGain);

        this.filter = context.createBiquadFilter();
        this.filter.type = "lowpass";

        const filterBase =
            560 +
            ((this.note - 36) / 36) * 760;

        this.filter.frequency.setValueAtTime(
            Math.max(520, Math.min(1320, filterBase)),
            now
        );

        this.filter.Q.setValueAtTime(0.35, now);

        this.filterLfo = context.createOscillator();
        this.filterLfoGain = context.createGain();

        this.filterLfo.type = "sine";
        this.filterLfo.frequency.setValueAtTime(0.035, now);
        this.filterLfoGain.gain.setValueAtTime(150, now);

        this.filterLfo.connect(this.filterLfoGain);
        this.filterLfoGain.connect(this.filter.frequency);

        this.lfo = context.createOscillator();
        this.lfoGain = context.createGain();

        this.lfo.type = "sine";
        this.lfo.frequency.setValueAtTime(0.055, now);
        this.lfoGain.gain.setValueAtTime(
            0.35 + this.velocity * 0.35,
            now
        );

        // No pitch modulation while a note is held.
        // Stable pitch is essential for the shared scale to remain consonant.

        this.gain = context.createGain();

        const peakGain = 0.105 * this.velocity;

        this.gain.gain.setValueAtTime(0.0001, now);
        this.gain.gain.exponentialRampToValueAtTime(
            Math.max(peakGain, 0.0002),
            now + 0.12
        );

        this.panner = context.createStereoPanner();

        const pan =
            ((this.note - 36) / 36) * 0.34 - 0.17;

        this.panner.pan.setValueAtTime(
            Math.max(-0.34, Math.min(0.34, pan)),
            now
        );

        this.reverbSend = context.createGain();
        this.reverbSend.gain.setValueAtTime(1.65, now);

        this.oscillatorAGain.connect(this.filter);
        this.oscillatorBGain.connect(this.filter);
        this.oscillatorCGain.connect(this.filter);

        this.filter.connect(this.gain);

        this.gain.connect(this.panner);
        this.panner.connect(this.destination);

        this.gain.connect(this.reverbSend);
        this.reverbSend.connect(this.reverbInput);

        this.lfo.start(now);
        this.filterLfo.start(now);

        this.oscillatorA.start(now);
        this.oscillatorB.start(now);
        this.oscillatorC.start(now);

        this.maxHoldTimer = window.setTimeout(
            () => this.release(),
            12000
        );
    }

    setSystemState({ count = 1, nearestDistance = null } = {}) {
        if (!this.audioContext || !this.gain || this.isReleased) {
            return;
        }

        this.systemCount = Math.max(1, count);
        this.nearestDistance = nearestDistance;

        const now = this.audioContext.currentTime;
        const proximity = Number.isFinite(nearestDistance)
            ? Math.max(0, Math.min(1, 1 - nearestDistance / 12))
            : 0;

        const systemLevel = Math.min(4, this.systemCount - 1);

        const filterDepth =
            150 +
            proximity * 180 +
            systemLevel * 80;

        const pitchDepth = 0;

        const upperLayer =
            0.20 +
            proximity * 0.025 +
            systemLevel * 0.018;

        const reverbAmount =
            1.65 +
            proximity * 0.25 +
            systemLevel * 0.10;

        const filterRate =
            0.035 +
            systemLevel * 0.025 +
            proximity * 0.012;

        this.filterLfo?.frequency.setTargetAtTime(
            filterRate,
            now,
            1.8
        );

        this.filterLfoGain?.gain.setTargetAtTime(
            filterDepth,
            now,
            1.6
        );

        this.lfoGain?.gain.setTargetAtTime(
            pitchDepth,
            now,
            0.08
        );

        this.oscillatorCGain?.gain.setTargetAtTime(
            upperLayer,
            now,
            1.8
        );

        this.reverbSend?.gain.setTargetAtTime(
            reverbAmount,
            now,
            2.2
        );

        this.oscillatorB?.detune.setTargetAtTime(
            -4,
            now,
            0.08
        );
    }

    release(force = false) {
        if (this.isReleased) {
            return;
        }

        this.isReleased = true;

        const context = this.audioContext;
        const now = context.currentTime;

        const currentGain =
            Math.max(this.gain.gain.value, 0.0001);

        const heldFor =
            Math.max(
                0,
                now - (this.startedAt ?? now)
            );

        const releaseTime = force
            ? 0.12
            : heldFor < 0.45
                ? 1.4
                : heldFor < 2
                    ? 2.4
                    : 3.6;

        this.gain.gain.cancelScheduledValues(now);
        this.gain.gain.setValueAtTime(currentGain, now);
        this.gain.gain.exponentialRampToValueAtTime(
            0.0001,
            now + releaseTime
        );

        this.reverbSend?.gain.cancelScheduledValues(now);
        this.reverbSend?.gain.setValueAtTime(
            Math.max(this.reverbSend.gain.value, 0.0001),
            now
        );
        this.reverbSend?.gain.exponentialRampToValueAtTime(
            0.0001,
            now + Math.min(releaseTime + 1.2, 4.5)
        );

        this.oscillatorA.stop(now + releaseTime + 0.1);
        this.oscillatorB.stop(now + releaseTime + 0.1);
        this.oscillatorC.stop(now + releaseTime + 0.1);
        this.lfo.stop(now + releaseTime + 0.1);
        this.filterLfo.stop(now + releaseTime + 0.1);

        if (this.maxHoldTimer !== null) {
            clearTimeout(this.maxHoldTimer);
            this.maxHoldTimer = null;
        }

        this.releaseTimer = window.setTimeout(
            () => this.disconnect(),
            (releaseTime + 0.5) * 1000
        );
    }

    disconnect() {
        if (this.releaseTimer !== null) {
            clearTimeout(this.releaseTimer);
            this.releaseTimer = null;
        }

        try { this.oscillatorA?.disconnect(); } catch {}
        try { this.oscillatorAGain?.disconnect(); } catch {}
        try { this.oscillatorB?.disconnect(); } catch {}
        try { this.oscillatorBGain?.disconnect(); } catch {}
        try { this.oscillatorC?.disconnect(); } catch {}
        try { this.oscillatorCGain?.disconnect(); } catch {}
        try { this.filter?.disconnect(); } catch {}
        try { this.gain?.disconnect(); } catch {}
        try { this.reverbSend?.disconnect(); } catch {}
        try { this.panner?.disconnect(); } catch {}
        try { this.lfo?.disconnect(); } catch {}
        try { this.lfoGain?.disconnect(); } catch {}
        try { this.filterLfo?.disconnect(); } catch {}
        try { this.filterLfoGain?.disconnect(); } catch {}

        this.oscillatorA = null;
        this.oscillatorB = null;
        this.oscillatorC = null;
        this.oscillatorAGain = null;
        this.oscillatorBGain = null;
        this.oscillatorCGain = null;
        this.filter = null;
        this.gain = null;
        this.reverbSend = null;
        this.panner = null;
        this.lfo = null;
        this.lfoGain = null;
        this.filterLfo = null;
        this.filterLfoGain = null;
    }
}
