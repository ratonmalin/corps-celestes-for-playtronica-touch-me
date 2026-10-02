const SAMPLE_REPOS = {
    violin: "AEmotionStudio/stringstudio-violin-samples",
    viola: "AEmotionStudio/stringstudio-viola-samples",
    cello: "AEmotionStudio/stringstudio-cello-samples"
};

const manifestCache = new Map();
const bufferCache = new Map();

export async function loadStringSamples(audioContext) {
    // Preload a small set of representative string zones after the AudioContext
    // is unlocked. This removes most of the first-note network/decode latency
    // without introducing a synthetic replacement for the acoustic instrument.
    const preloadTargets = {
        violin: [48, 60, 72],
        viola: [48, 60, 72],
        cello: [36, 48, 60]
    };

    await Promise.all(
        Object.entries(preloadTargets).map(async ([instrument, notes]) => {
            try {
                const manifest = await loadManifest(instrument);
                if (!manifest?.zones?.length) return;

                await Promise.all(
                    notes.map(note => preloadNearestZone(audioContext, instrument, manifest, note))
                );
            } catch (error) {
                console.warn("[STRINGS] Sample preload unavailable:", instrument, error);
            }
        })
    );

    return true;
}

async function preloadNearestZone(audioContext, instrument, manifest, midi) {
    const candidates = manifest.zones.filter(zone =>
        midi >= Number(zone.lowPitch ?? -Infinity) &&
        midi <= Number(zone.highPitch ?? Infinity)
    );

    const zones = candidates.length ? candidates : manifest.zones;
    const zone = [...zones].sort((a, b) =>
        Math.abs(Number(a.rootPitch) - midi) -
        Math.abs(Number(b.rootPitch) - midi)
    )[0];

    if (!zone?.file) return null;

    const url =
        "https://huggingface.co/" +
        SAMPLE_REPOS[instrument] +
        "/resolve/main/" +
        zone.file;

    return loadSampleBuffer(audioContext, url);
}

async function loadSampleBuffer(audioContext, url) {
    if (!bufferCache.has(url)) {
        const response = await fetch(url, { cache: "force-cache" });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} while loading ${url}`);
        }

        const data = await response.arrayBuffer();
        bufferCache.set(url, audioContext.decodeAudioData(data));
    }

    return bufferCache.get(url);
}

export async function getStringSample(audioContext, instrument, note, velocity = 1) {
    const repo = SAMPLE_REPOS[instrument];
    if (!repo) return null;

    const manifest = await loadManifest(instrument);
    if (!manifest?.zones?.length) return null;

    const midi = Math.max(0, Math.min(127, Math.round(note)));
    const vel = Math.max(0, Math.min(127, Math.round(velocity * 127)));

    const candidates = manifest.zones.filter(zone =>
        midi >= Number(zone.lowPitch ?? -Infinity) &&
        midi <= Number(zone.highPitch ?? Infinity) &&
        vel >= Number(zone.lowVelocity ?? 0) &&
        vel <= Number(zone.highVelocity ?? 127)
    );

    const zones = candidates.length
        ? candidates
        : manifest.zones;

    zones.sort((a, b) =>
        Math.abs(Number(a.rootPitch) - midi) -
        Math.abs(Number(b.rootPitch) - midi)
    );

    const zone = zones[0];
    if (!zone?.file) return null;

    const url =
        "https://huggingface.co/" +
        repo +
        "/resolve/main/" +
        zone.file;

    const cacheKey = url;

    const buffer = await loadSampleBuffer(audioContext, cacheKey);

    return {
        buffer,
        rootPitch: Number(zone.rootPitch)
    };
}

async function loadManifest(instrument) {
    if (manifestCache.has(instrument)) {
        return manifestCache.get(instrument);
    }

    const repo = SAMPLE_REPOS[instrument];
    const promise = fetch(
        "https://huggingface.co/" +
        repo +
        "/resolve/main/manifest.json",
        { cache: "force-cache" }
    )
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} while loading string manifest`);
            }
            return response.json();
        });

    manifestCache.set(instrument, promise);
    return promise;
}
