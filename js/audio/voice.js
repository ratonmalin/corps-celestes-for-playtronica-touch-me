export class Voice {

    constructor(
        audioContext,
        destination,
        reverbInput,
        delayInput,
        echoInput,
        { note, velocity, chord = false, chordIntervals = [0, 4, 7] }
    ) {
        this.audioContext = audioContext;
        this.destination = destination;
        this.reverbInput = reverbInput;
        this.delayInput = delayInput;
        this.echoInput = echoInput;

        this.baseNote = note;
        this.note = note;
        this.velocity = velocity;
        this.instrument = "synth";
        this.chord = Boolean(chord);
        this.chordIntervals = Array.isArray(chordIntervals) && chordIntervals.length === 3
            ? chordIntervals
            : [0, 4, 7];

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


    setInstrument(instrument) {
        const allowed = ["synth", "strings", "harp"];
        this.instrument = allowed.includes(instrument) ? instrument : "synth";

        // The harp lives one octave above the common TouchMe register.
        this.note = this.instrument === "harp"
            ? this.baseNote + 12
            : this.baseNote;
    }

    start() {

        const context = this.audioContext;
        const now = context.currentTime;
        this.startedAt = now;

        const frequency =
            440 * Math.pow(
                2,
                (this.note - 69) / 12
            );

        const useChord = this.chord || this.instrument === "strings";
        const chordFrequencies = useChord
            ? this.chordIntervals.map(interval =>
                frequency * Math.pow(2, interval / 12)
            )
            : [frequency, frequency, frequency];


        /*
         * NOTE PRINCIPALE
         */

        this.oscillatorA =
            context.createOscillator();

        this.oscillatorA.type =
            this.instrument === "strings" ? "sawtooth"
            : this.instrument === "harp" ? "triangle"
            : "sine";

        this.oscillatorA.frequency
            .setValueAtTime(
                frequency,
                now
            );


        /*
         * SECONDE COUCHE
         */

        this.oscillatorB =
            context.createOscillator();

        this.oscillatorB.type =
            this.instrument === "strings" ? "sawtooth"
            : this.instrument === "harp" ? "sine"
            : "sine";

        this.oscillatorB.frequency
            .setValueAtTime(
                chordFrequencies[1],
                now
            );

        this.oscillatorB.detune
            .setValueAtTime(
                this.instrument === "strings" ? -11 : 5,
                now
            );


        /*
         * OCTAVE SUPÉRIEURE
         *
         * Conservée comme dans la version
         * qui fonctionnait.
         */

        this.oscillatorC =
            context.createOscillator();

        this.oscillatorC.type =
            this.instrument === "strings" ? "triangle"
            : this.instrument === "harp" ? "sine"
            : "sine";

        this.oscillatorC.frequency
            .setValueAtTime(
                useChord
                    ? chordFrequencies[2]
                    : frequency * 2,
                now
            );

        this.oscillatorC.detune
            .setValueAtTime(
                this.instrument === "strings" ? 9
                    : this.instrument === "harp" ? -3
                    : -4,
                now
            );


        /*
         * MIXAGE DES OSCILLATEURS
         *
         * La fondamentale reste dominante.
         * Les couches aiguës sont volontairement
         * discrètes pour éviter le côté perçant.
         */

        this.oscillatorAGain = context.createGain();
        this.oscillatorBGain = context.createGain();
        this.oscillatorCGain = context.createGain();

        const mix =
            this.instrument === "strings"
                ? [0.48, 0.38, 0.14]
                : this.instrument === "harp"
                    ? [0.62, 0.24, 0.14]
                    : [0.72, 0.24, 0.08];

        this.oscillatorAGain.gain.setValueAtTime(mix[0], now);
        this.oscillatorBGain.gain.setValueAtTime(mix[1], now);
        this.oscillatorCGain.gain.setValueAtTime(mix[2], now);

        this.oscillatorA.connect(this.oscillatorAGain);
        this.oscillatorB.connect(this.oscillatorBGain);
        this.oscillatorC.connect(this.oscillatorCGain);


        /*
         * FILTRE
         */

        this.filter =
            context.createBiquadFilter();

        this.filter.type = "lowpass";

        const filterBase =
            this.instrument === "strings"
                ? 950 + ((this.note - 24) / 36) * 1050
                : this.instrument === "harp"
                    ? 1800 + ((this.note - 36) / 36) * 1000
                    : 850 + ((this.note - 48) / 31) * 1050;

        this.filter.frequency
            .setValueAtTime(
                Math.max(650, Math.min(this.instrument === "harp" ? 2700 : 1900, filterBase)),
                now
            );

        this.filter.Q
            .setValueAtTime(
                0.25,
                now
            );


        /*
         * MODULATION TRÈS LENTE DU FILTRE
         */

        this.filterLfo =
            context.createOscillator();

        this.filterLfoGain =
            context.createGain();

        this.filterLfo.type = "sine";

        this.filterLfo.frequency
            .setValueAtTime(
                0.05,
                now
            );

        this.filterLfoGain.gain
            .setValueAtTime(
                this.instrument === "strings"
                    ? 180
                    : this.instrument === "harp"
                        ? 90
                        : 280,
                now
            );

        this.filterLfo.connect(
            this.filterLfoGain
        );

        this.filterLfoGain.connect(
            this.filter.frequency
        );


        /*
         * PETIT MOUVEMENT DE HAUTEUR
         */

        this.lfo =
            context.createOscillator();

        this.lfoGain =
            context.createGain();

        this.lfo.type = "sine";

        this.lfo.frequency
            .setValueAtTime(
                0.08,
                now
            );

        this.lfoGain.gain
            .setValueAtTime(
                this.instrument === "strings"
                    ? 0.8 + this.velocity * 0.7
                    : this.instrument === "harp"
                        ? 0.35
                        : 1.2 + this.velocity * 0.8,
                now
            );

        this.lfo.connect(
            this.lfoGain
        );

        this.lfoGain.connect(
            this.oscillatorA.detune
        );

        this.lfoGain.connect(
            this.oscillatorB.detune
        );

        this.lfoGain.connect(
            this.oscillatorC.detune
        );


        /*
         * ENVELOPPE
         */

        this.gain =
            context.createGain();

        const peakGain =
            (this.instrument === "strings"
                ? 0.072
                : this.instrument === "harp" ? 0.12 : 0.095) * this.velocity;

        this.gain.gain
            .setValueAtTime(
                0.0001,
                now
            );


        /*
         * ATTAQUE
         */

        const attack =
            this.instrument === "strings" ? 0.18
                : this.instrument === "harp" ? 0.004
                : 0.07;

        this.gain.gain
            .exponentialRampToValueAtTime(
                Math.max(
                    peakGain,
                    0.0002
                ),
                now + attack
            );

        if (this.instrument === "harp") {
            this.oscillatorA.frequency.setValueAtTime(frequency * 1.018, now);
            this.oscillatorA.frequency.exponentialRampToValueAtTime(
                frequency,
                now + 0.055
            );
            this.oscillatorB.frequency.setValueAtTime(frequency * 1.012, now);
            this.oscillatorB.frequency.exponentialRampToValueAtTime(
                frequency,
                now + 0.04
            );
            this.oscillatorC.frequency.setValueAtTime(frequency * 2.008, now);
            this.oscillatorC.frequency.exponentialRampToValueAtTime(
                frequency * 2,
                now + 0.035
            );
        }


        /*
         * POSITION STÉRÉO
         */

        this.panner =
            context.createStereoPanner();

        const pan =
            this.instrument === "strings"
                ? ((this.note - 24) / 36) * 0.38 - 0.19
                : this.instrument === "harp"
                    ? ((this.note - 36) / 36) * 0.42 - 0.21
                    : ((this.note - 24) / 36) * 0.5 - 0.25;

        this.panner.pan
            .setValueAtTime(
                pan,
                now
            );


        /*
         * SEND REVERB
         */

        this.reverbSend =
            context.createGain();

        this.reverbSend.gain
            .setValueAtTime(
                this.instrument === "strings" ? 1.55
                    : this.instrument === "harp" ? 0
                    : 1.15,
                now
            );


        /*
         * ROUTING
         */

        this.oscillatorAGain.connect(this.filter);
        this.oscillatorBGain.connect(this.filter);
        this.oscillatorCGain.connect(this.filter);

        this.filter.connect(
            this.gain
        );


        /*
         * SIGNAL DIRECT
         */

        this.gain.connect(
            this.panner
        );

        this.panner.connect(
            this.destination
        );


        /*
         * SIGNAL REVERB
         */

        this.gain.connect(
            this.reverbSend
        );

        this.gain.connect(this.delayInput);
        this.gain.connect(this.echoInput);

        this.reverbSend.connect(
            this.reverbInput
        );


        /*
         * DÉMARRAGE
         */

        this.lfo.start(now);
        this.filterLfo.start(now);

        this.oscillatorA.start(now);
        this.oscillatorB.start(now);
        this.oscillatorC.start(now);

        // A MIDI controller can lose a Note Off (USB disconnect, browser
        // visibility change, device state change). Never leave a voice alive
        // forever in that case.
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

        const complexity = Math.max(
            0,
            Math.min(1, (this.systemCount - 1) / 4)
        );

        // The audio has distinct physical regimes rather than merely
        // getting louder as more notes are added.
        const systemLevel = Math.min(4, this.systemCount - 1);
        const filterDepth =
            280 +
            proximity * 420 +
            systemLevel * 180;

        const pitchBase =
            this.instrument === "strings"
                ? 0.8 + this.velocity * 0.7
                : this.instrument === "harp"
                    ? 0.35
                    : 1.2 + this.velocity * 0.8;

        const pitchDepth =
            pitchBase +
            proximity * (this.instrument === "harp" ? 0.25 : 1.1) +
            systemLevel * (this.instrument === "harp" ? 0.08 : 0.45);

        const upperLayer =
            0.08 +
            proximity * 0.08 +
            systemLevel * 0.055;

        const reverbAmount =
            this.instrument === "harp"
                ? 0
                : 1.15 + proximity * 0.32 + systemLevel * 0.16;

        const filterRate =
            0.05 +
            systemLevel * 0.055 +
            proximity * 0.025;

        this.filterLfo?.frequency.setTargetAtTime(
            filterRate,
            now,
            1.4
        );

        this.filterLfoGain?.gain.setTargetAtTime(
            filterDepth,
            now,
            1.2
        );

        this.lfoGain?.gain.setTargetAtTime(
            pitchDepth,
            now,
            1.4
        );

        this.oscillatorCGain?.gain.setTargetAtTime(
            upperLayer,
            now,
            1.6
        );

        this.reverbSend?.gain.setTargetAtTime(
            reverbAmount,
            now,
            1.8
        );

        const internalDetune =
            this.instrument === "strings"
                ? -11 + systemLevel * 0.7 + proximity * 0.8
                : 5 + systemLevel * 2.2 + proximity * 3.5;

        this.oscillatorB?.detune.setTargetAtTime(
            internalDetune,
            now,
            1.5
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
            Math.max(
                this.gain.gain.value,
                0.0001
            );

        const heldFor =
            Math.max(
                0,
                now - (this.startedAt ?? now)
            );

        const releaseTime = force
            ? 0.12
            : this.instrument === "strings"
                ? (heldFor < 0.45 ? 1.8 : heldFor < 2 ? 3.2 : 4.2)
                : this.instrument === "harp"
                    ? (heldFor < 0.45 ? 0.45 : heldFor < 2 ? 0.9 : 1.35)
                    : (heldFor < 0.45 ? 1.1 : heldFor < 2 ? 1.8 : 2.6);

        /*
         * RELEASE ADAPTATIF
         *
         * Une note brève disparaît plus vite.
         * Une note tenue conserve une longue traîne.
         */

        this.gain.gain
            .cancelScheduledValues(now);

        this.gain.gain
            .setValueAtTime(
                currentGain,
                now
            );

        this.gain.gain
            .exponentialRampToValueAtTime(
                0.0001,
                now + releaseTime
            );

        this.reverbSend?.gain
            .cancelScheduledValues(now);

        this.reverbSend?.gain
            .setValueAtTime(
                Math.max(this.reverbSend.gain.value, 0.0001),
                now
            );

        this.reverbSend?.gain
            .exponentialRampToValueAtTime(
                0.0001,
                now + Math.min(releaseTime, 2.2)
            );


        this.oscillatorA.stop(
            now + releaseTime + 0.1
        );

        this.oscillatorB.stop(
            now + releaseTime + 0.1
        );

        this.oscillatorC.stop(
            now + releaseTime + 0.1
        );

        this.lfo.stop(
            now + releaseTime + 0.1
        );

        this.filterLfo.stop(
            now + releaseTime + 0.1
        );


        if (this.maxHoldTimer !== null) {
            clearTimeout(this.maxHoldTimer);
            this.maxHoldTimer = null;
        }

        this.releaseTimer =
            window.setTimeout(
                () => {
                    this.disconnect();
                },
                (releaseTime + 0.35) * 1000
            );
    }


    disconnect() {

        if (this.releaseTimer !== null) {

            clearTimeout(
                this.releaseTimer
            );

            this.releaseTimer = null;
        }


        try {
            this.oscillatorA?.disconnect();
        } catch {}

        try {
            this.oscillatorAGain?.disconnect();
        } catch {}

        try {
            this.oscillatorB?.disconnect();
        } catch {}

        try {
            this.oscillatorBGain?.disconnect();
        } catch {}

        try {
            this.oscillatorC?.disconnect();
        } catch {}

        try {
            this.oscillatorCGain?.disconnect();
        } catch {}

        try {
            this.filter?.disconnect();
        } catch {}

        try {
            this.gain?.disconnect();
        } catch {}

        try {
            this.reverbSend?.disconnect();
        } catch {}

        try {
            this.panner?.disconnect();
        } catch {}

        try {
            this.lfo?.disconnect();
        } catch {}

        try {
            this.lfoGain?.disconnect();
        } catch {}

        try {
            this.filterLfo?.disconnect();
        } catch {}

        try {
            this.filterLfoGain?.disconnect();
        } catch {}


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
