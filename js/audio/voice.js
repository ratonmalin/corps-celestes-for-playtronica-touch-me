export class Voice {

    constructor(
        audioContext,
        destination,
        reverbInput,
        delayInput,
        echoInput,
        { note, velocity }
    ) {
        this.audioContext = audioContext;
        this.destination = destination;
        this.reverbInput = reverbInput;
        this.delayInput = delayInput;
        this.echoInput = echoInput;

        this.note = note;
        this.velocity = velocity;
        this.instrument = "synth";

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
                frequency,
                now
            );

        this.oscillatorB.detune
            .setValueAtTime(
                this.instrument === "strings" ? -7 : 5,
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
                this.instrument === "harp" ? frequency * 2
                    : frequency * 2,
                now
            );

        this.oscillatorC.detune
            .setValueAtTime(
                this.instrument === "strings" ? 7
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
                ? [0.52, 0.34, 0.14]
                : this.instrument === "harp"
                    ? [0.68, 0.22, 0.10]
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
                ? 1100 + ((this.note - 24) / 36) * 1300
                : this.instrument === "harp"
                    ? 1800 + ((this.note - 24) / 36) * 1400
                    : 850 + ((this.note - 48) / 31) * 1050;

        this.filter.frequency
            .setValueAtTime(
                Math.max(700, Math.min(1900, filterBase)),
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
                280,
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
                1.2 + this.velocity * 0.8,
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
            (this.instrument === "harp" ? 0.11 : 0.095) * this.velocity;

        this.gain.gain
            .setValueAtTime(
                0.0001,
                now
            );


        /*
         * ATTAQUE
         */

        const attack =
            this.instrument === "strings" ? 0.32
                : this.instrument === "harp" ? 0.012
                : 0.07;

        this.gain.gain
            .exponentialRampToValueAtTime(
                Math.max(
                    peakGain,
                    0.0002
                ),
                now + attack
            );


        /*
         * POSITION STÉRÉO
         */

        this.panner =
            context.createStereoPanner();

        const pan =
            ((this.note - 24) / 36) * 0.5 - 0.25;

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
                this.instrument === "strings" ? 1.35
                    : this.instrument === "harp" ? 1.45
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

        const pitchDepth =
            1.2 +
            this.velocity * 0.8 +
            proximity * 1.1 +
            systemLevel * 0.45;

        const upperLayer =
            0.08 +
            proximity * 0.08 +
            systemLevel * 0.055;

        const reverbAmount =
            1.15 +
            proximity * 0.32 +
            systemLevel * 0.16;

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
            5 +
            systemLevel * 2.2 +
            proximity * 3.5;

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
                    ? (heldFor < 0.45 ? 0.8 : heldFor < 2 ? 1.4 : 2.0)
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
