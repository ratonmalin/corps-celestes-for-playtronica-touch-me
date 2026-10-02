export class VisualEngine {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.canvas = null;
        this.ctx = null;

        this.active = new Map();
        this.bodyPositions = new Map();
        this.memory = [];
        this.running = false;
        this.lastInteraction = performance.now();
        this.lastBloom = 0;
        this.chordStartedAt = 0;
        this.chordSize = 0;
        this.chordParticles = [];
        this.maxActiveBodies = 32;
        this.maxMemoryStars = 500;
        this.lastFrameError = 0;
        this.sleepCycle = -1;
        this.sleepMessageIndex = -1;
        this.interactionCount = 0;
        // Visual palette is intentionally immutable during a session.
        // Changing the musical scale must never recolor existing or new bodies.

        this.onNoteOn = this.onNoteOn.bind(this);
        this.onNoteOff = this.onNoteOff.bind(this);
        this.frame = this.frame.bind(this);
        this.handleResize = this.handleResize.bind(this);

        eventBus.on("noteon", this.onNoteOn);
        eventBus.on("noteoff", this.onNoteOff);
    }

    start() {
        this.canvas = document.createElement("canvas");
        this.canvas.className = "visual-field";
        this.canvas.setAttribute("aria-hidden", "true");
        const app = document.querySelector(".app");
        (app || document.body).prepend(this.canvas);

        this.ctx = this.canvas.getContext("2d");
        this.resize();

        window.addEventListener("resize", this.handleResize);

        this.running = true;
        requestAnimationFrame(this.frame);
    }

    stop() {
        this.running = false;
        window.removeEventListener("resize", this.handleResize);
    }

    handleResize() {
        this.resize();
    }

    resize() {
        if (!this.canvas || !this.ctx) return;

        const width = Math.max(
            1,
            Number.isFinite(window.innerWidth) ? window.innerWidth : 1
        );
        const height = Math.max(
            1,
            Number.isFinite(window.innerHeight) ? window.innerHeight : 1
        );
        const ratio = Math.min(
            Math.max(window.devicePixelRatio || 1, 1),
            2
        );

        this.canvas.width = Math.floor(width * ratio);
        this.canvas.height = Math.floor(height * ratio);
        this.canvas.style.width = width + "px";
        this.canvas.style.height = height + "px";

        this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    getBodyId(event) {
        return `${event.source}-${event.channel}-${event.note}`;
    }

    getVisualStyle() {
        return {
            palette: [
                "#61E7FF",
                "#FF6B8A",
                "#B58CFF",
                "#7CFFB2",
                "#FFD166",
                "#F5F7FF",
                "#4DA6FF"
            ],
            saturation: 78,
            lightness: 76,
            insideForce: 0.065,
            drag: 0.9992,
            maxSpeed: 1,
            trail: 1
        };
    }

    getNoteHue(note) {
        const safeNote = Number.isFinite(note) ? note : 48;
        const style = this.getVisualStyle();
        const paletteIndex =
            Math.abs(Math.round(safeNote - 60)) %
            style.palette.length;

        return style.palette[paletteIndex];
    }

    hexToRgba(hex, alpha) {
        const value = hex.replace("#", "");
        const red = parseInt(value.slice(0, 2), 16);
        const green = parseInt(value.slice(2, 4), 16);
        const blue = parseInt(value.slice(4, 6), 16);

        return `${red}, ${green}, ${blue}, ${alpha}`;
    }

    getNoteProfile(note) {
        const safeNote = Number.isFinite(note) ? note : 60;
        return Math.min(1, Math.max(0, (safeNote - 60) / 16));
    }

    onNoteOn(event) {
        if (!event || !Number.isFinite(event.note)) return;

        const now = performance.now();
        const id = this.getBodyId(event);

        this.lastInteraction = now;
        this.interactionCount++;
        this.sleepCycle = -1;

        const existing = this.active.get(id);

        if (existing && !existing.releasedAt) {
            existing.velocity = Math.max(
                0,
                Math.min(
                    1,
                    Number.isFinite(event.velocity) ? event.velocity : 1
                )
            );
            // Do not reset born on repeated Note On messages.
            // Playtron can retrigger a held note; resetting the age here
            // also resets the global trail reveal and makes the whole
            // background galaxy fade/restart.
            existing.lastRetriggerAt = now;
            existing.retriggerPulse = 1;
            return;
        }

        if (this.active.size >= this.maxActiveBodies) {
            const oldest = [...this.active.values()]
                .filter(item => item.releasedAt)
                .sort((a, b) => a.releasedAt - b.releasedAt)[0];

            if (oldest) {
                this.active.delete(oldest.id);
            } else {
                return;
            }
        }

        const heldItems = [...this.active.values()]
            .filter(item => !item.releasedAt);

        const previousCount = heldItems.length;

        if (previousCount === 1) {
            this.chordStartedAt = now;
            this.chordSize = 2;

            const particleCount = 96;
            this.chordParticles = Array.from(
                { length: particleCount },
                (_, index) => {
                    const angle =
                        (index / particleCount) * Math.PI * 2 +
                        Math.sin(index * 2.17) * 0.16;

                    const speed =
                        70 +
                        (index % 11) * 17 +
                        Math.sin(index * 1.31) * 22;

                    return {
                        angle,
                        speed,
                        size: 0.45 + (index % 4) * 0.35,
                        life: 1.6 + (index % 7) * 0.22,
                        hue: 190 + (index % 9) * 19,
                        offset: (index % 5) * 0.045
                    };
                }
            );
        } else if (previousCount > 1) {
            this.chordSize = Math.min(6, previousCount + 1);
        }

        this.active.set(id, {
            id,
            note: event.note,
            source: event.source,
            born: now,
            releasedAt: null,
            velocity: Math.max(
                0,
                Math.min(
                    1,
                    Number.isFinite(event.velocity) ? event.velocity : 1
                )
            ),
            angle: ((event.note * 47) % 360) * Math.PI / 180,
            phase: (event.note * 0.71) % (Math.PI * 2),
            hue: this.getNoteHue(event.note),
            duration: null,
            mass: 0.75 + ((event.note % 12) / 11) * 0.55,
            x: this.bodyPositions.get(event.note)?.x ??
                innerWidth * (0.5 + Math.sin(event.note * 1.73) * 0.32),
            y: this.bodyPositions.get(event.note)?.y ??
                innerHeight * (0.47 + Math.cos(event.note * 1.17) * 0.25),
            vx: this.bodyPositions.get(event.note)?.vx ??
                Math.cos(event.note * 0.83) * 18,
            vy: this.bodyPositions.get(event.note)?.vy ??
                Math.sin(event.note * 0.61) * 18,
            trail: []
        });
    }

    onNoteOff(event) {
        if (!event || !Number.isFinite(event.note)) return;

        const id = this.getBodyId(event);
        const item = this.active.get(id);

        this.lastInteraction = performance.now();

        if (!item) return;

        item.releasedAt = performance.now();
        item.duration = Math.max(0.05, (item.releasedAt - item.born) / 1000);

        this.bodyPositions.set(item.note, {
            x: item.x,
            y: item.y,
            vx: item.vx,
            vy: item.vy
        });

        const memoryIndex = this.memory.length;
        const seed = item.note * 12.9898 + memoryIndex * 78.233;
        const randomX = (Math.sin(seed) * 43758.5453) % 1;
        const randomY = (Math.sin(seed + 19.19) * 43758.5453) % 1;

        this.memory.push({
            x: innerWidth * (0.10 + Math.abs(randomX) * 0.80),
            y: innerHeight * (0.12 + Math.abs(randomY) * 0.72),
            born: performance.now(),
            note: item.note,
            color: item.hue,
            duration: item.duration,
            energy: item.velocity,
            // Memory stars never expire. Their presence slowly settles
            // instead of vanishing, so idle becomes a continuation of the
            // interaction rather than a reset.
            lifetime: Infinity,
            seed,
            phase: (item.note * 0.71 + memoryIndex * 0.37) % (Math.PI * 2),
            depth: 0.25 + ((Math.sin(seed * 0.73) + 1) * 0.5) * 0.75,
            driftX: Math.sin(seed * 1.17) * 0.65,
            driftY: Math.cos(seed * 0.91) * 0.45,
            path: (item.trail ?? []).map(point => ({
                x: point.x,
                y: point.y,
                born: point.born
            }))
        });

        if (this.memory.length > this.maxMemoryStars) {
            this.memory.splice(
                0,
                this.memory.length - this.maxMemoryStars
            );
        }
    }

    getSystemCenter() {
        if (this.active.size === 0) {
            return {
                x: innerWidth * 0.5,
                y: innerHeight * 0.47
            };
        }

        let x = 0;
        let y = 0;

        let count = 0;

        for (const item of this.active.values()) {
            const itemX = Number.isFinite(item.x)
                ? item.x
                : innerWidth * 0.5;
            const itemY = Number.isFinite(item.y)
                ? item.y
                : innerHeight * 0.47;

            x += itemX;
            y += itemY;
            count++;
        }

        if (count === 0) {
            return {
                x: innerWidth * 0.5,
                y: innerHeight * 0.47
            };
        }

        return {
            x: x / count,
            y: y / count
        };
    }

    updateActiveBodies(now) {
        const items = [...this.active.values()];
        const count = items.length;
        const center = this.getSystemCenter();
        const elapsed = now / 1000;

        for (const item of items) {
            const age = (now - item.born) / 1000;
            const noteProfile = this.getNoteProfile(item.note);
            const baseX =
                innerWidth * (0.5 + Math.sin(item.note * 1.73) * 0.32);
            const baseY =
                innerHeight * (0.47 + Math.cos(item.note * 1.17) * 0.25);

            if (count >= 2) {
                const dt = Math.min(
                    0.033,
                    Math.max(0.008, (now - (item.lastFrame ?? now)) / 1000)
                );

                let ax = 0;
                let ay = 0;

                // Soft n-body gravity: the forms now create each other's
                // trajectories instead of following independent animations.
                for (const other of items) {
                    if (other === item || other.releasedAt) continue;

                    const dx = other.x - item.x;
                    const dy = other.y - item.y;
                    const distanceSq = Math.max(
                        2600,
                        dx * dx + dy * dy
                    );

                    const distance = Math.sqrt(distanceSq);
                    const gravityStrength =
                        5200 * (1 + Math.max(0, count - 2) * 0.55);
                    const force =
                        gravityStrength *
                        (other.mass ?? 1) /
                        distanceSq;

                    ax += (dx / distance) * force;
                    ay += (dy / distance) * force;
                }

                // A soft central field keeps the whole system inside
                // the visual field while still allowing large orbits.
                const fieldCenterX = innerWidth * 0.5;
                const fieldCenterY = innerHeight * 0.47;
                const centerDx = fieldCenterX - item.x;
                const centerDy = fieldCenterY - item.y;
                const centerDistance = Math.hypot(centerDx, centerDy);
                const fieldRadius =
                    Math.min(innerWidth, innerHeight) * 0.30;

                const style = this.getVisualStyle();
                const insideForce = style.insideForce;
                ax += centerDx * insideForce;
                ay += centerDy * insideForce;

                // Once a body crosses the comfortable visual radius, the
                // restoring field becomes noticeably stronger. This prevents
                // sustained interactions from turning into screen-wide orbits.
                if (centerDistance > fieldRadius) {
                    const excess =
                        Math.min(
                            1,
                            (centerDistance - fieldRadius) /
                                Math.max(1, fieldRadius)
                        );

                    const outsideForce =
                        0.10 + excess * 0.16;

                    ax += centerDx * outsideForce;
                    ay += centerDy * outsideForce;

                    // Remove a little outward radial momentum at the same
                    // time, without freezing the tangential orbital motion.
                    const radialVelocity =
                        (item.vx * (item.x - fieldCenterX) +
                            item.vy * (item.y - fieldCenterY)) /
                        Math.max(1, centerDistance);

                    if (radialVelocity > 0) {
                        const radialX =
                            (item.x - fieldCenterX) /
                            Math.max(1, centerDistance);
                        const radialY =
                            (item.y - fieldCenterY) /
                            Math.max(1, centerDistance);

                        item.vx -= radialX * radialVelocity * 0.10;
                        item.vy -= radialY * radialVelocity * 0.10;
                    }
                }

                // A very slow shared drift keeps the system from becoming
                // perfectly static when two bodies settle into an orbit.
                const drift =
                    Math.sin(elapsed * 0.32 + item.phase) * 2.4;

                ax += Math.cos(item.phase + elapsed * 0.18) * drift;
                ay += Math.sin(item.phase + elapsed * 0.18) * drift;

                item.vx += ax * dt;
                item.vy += ay * dt;

                const speed = Math.hypot(item.vx, item.vy);
                const maxSpeed =
                    (
                        (count >= 4 ? 150 : 120) +
                        noteProfile * (count >= 4 ? 90 : 70)
                    ) * style.maxSpeed;

                if (speed > maxSpeed) {
                    item.vx =
                        (item.vx / speed) * maxSpeed;
                    item.vy =
                        (item.vy / speed) * maxSpeed;
                }

                // Keep enough momentum for visible orbital motion without
                // letting the system accelerate indefinitely.
                item.vx *= style.drag;
                item.vy *= style.drag;

                item.x += item.vx * dt;
                item.y += item.vy * dt;
                this.bodyPositions.set(item.note, {
                    x: item.x,
                    y: item.y,
                    vx: item.vx,
                    vy: item.vy
                });

                // Long holds stay in the physical orbit. No late formation
                // target is applied: this keeps trajectories continuous over time.

                // During the first second of a chord, the system briefly
                // reorganizes itself into a constellation before returning
                // to its natural orbital motion.
                if (
                    this.chordStartedAt &&
                    !item.releasedAt
                ) {
                    const chordAge =
                        (now - this.chordStartedAt) / 1000;

                    if (chordAge >= 0 && chordAge < 1.35) {
                        const liveItems = items.filter(
                            candidate => !candidate.releasedAt
                        );

                        const ordered = [...liveItems].sort(
                            (a, b) => a.note - b.note
                        );

                        const index = ordered.indexOf(item);

                        if (index !== -1 && ordered.length >= 2) {
                            const centerX = center.x;
                            const centerY = center.y;
                            const rotation =
                                chordAge * (0.45 + this.chordSize * 0.08);

                            const radius =
                                this.chordSize <= 2
                                    ? 105
                                    : 88 + this.chordSize * 18;

                            const targetAngle =
                                rotation +
                                (index / ordered.length) *
                                    Math.PI * 2 -
                                Math.PI / 2;

                            const targetX =
                                centerX +
                                Math.cos(targetAngle) * radius;

                            const targetY =
                                centerY +
                                Math.sin(targetAngle) *
                                    radius *
                                    0.68;

                            const formation =
                                Math.min(
                                    1,
                                    Math.max(0, chordAge / 0.42)
                                );

                            const eased =
                                formation * formation *
                                (3 - 2 * formation);

                            item.x +=
                                (targetX - item.x) *
                                eased *
                                dt *
                                7.5;

                            item.y +=
                                (targetY - item.y) *
                                eased *
                                dt *
                                7.5;
                        }
                    }
                }

                const margin = 80;

                if (item.x < margin || item.x > innerWidth - margin) {
                    item.vx *= -0.82;
                    item.x = Math.max(
                        margin,
                        Math.min(innerWidth - margin, item.x)
                    );
                }

                if (item.y < margin || item.y > innerHeight - margin) {
                    item.vy *= -0.82;
                    item.y = Math.max(
                        margin,
                        Math.min(innerHeight - margin, item.y)
                    );
                }

                item.lastFrame = now;
                item.chaotic = true;
            } else {
                // Single bodies keep their current trajectory. The previous
                // implementation recomputed x/y directly from age, which
                // caused a discontinuity when a chord collapsed to one note.
                const targetOrbit =
                    118 -
                    noteProfile * 68 +
                    Math.min(age, 3) * (6 - noteProfile * 2);

                const targetAngle =
                    item.angle +
                    age * (0.085 + noteProfile * 0.22);

                const targetX =
                    baseX + Math.cos(targetAngle) * targetOrbit;
                const targetY =
                    baseY + Math.sin(targetAngle) * targetOrbit * 0.62;

                const follow =
                    Math.min(1, Math.max(0, dt * 1.15));

                item.x += (targetX - item.x) * follow;
                item.y += (targetY - item.y) * follow;

                // Keep the stored trajectory coherent for a future retrigger.
                this.bodyPositions.set(item.note, {
                    x: item.x,
                    y: item.y,
                    vx: item.vx,
                    vy: item.vy
                });

                item.chaotic = false;
            }

            if (item.releasedAt) {
                const releaseAge =
                    Math.max(0, (now - item.releasedAt) / 1000);
                const releaseDuration = 2.2;
                const releaseProgress =
                    Math.min(1, releaseAge / releaseDuration);

                item.releaseLife =
                    1 -
                    (releaseProgress * releaseProgress *
                        (3 - 2 * releaseProgress));

                if (releaseProgress >= 1) {
                    this.active.delete(item.id);
                }
            } else {
                item.releaseLife = 1;
            }
        }
    }

    drawMemory(ctx, now, layerStrength = 1) {
        // IMPORTANT: idle state is UI-only. It must never alter star visibility.
        // The memory sky is rendered continuously, including after 15 seconds.

        // Persistent stars drift at different depths. The motion is deliberately
        // slow enough to feel like a living sky rather than particles.
        for (const star of this.memory) {
            const depth = star.depth ?? 0.5;
            const drift = 0.18 + depth * 0.72;

            star.x += Math.sin(now / 10000 + star.phase) *
                star.driftX * drift * 0.018;
            star.y += Math.cos(now / 12000 + star.phase * 1.13) *
                star.driftY * drift * 0.018;

            const margin = 24;
            if (star.x < margin) star.x = margin;
            if (star.x > innerWidth - margin) star.x = innerWidth - margin;
            if (star.y < margin) star.y = margin;
            if (star.y > innerHeight - margin) star.y = innerHeight - margin;
        }

        // A restrained pulse propagates through the whole sky after interaction.
        const pulseAge = (now - this.lastInteraction) / 1000;
        if (pulseAge >= 0 && pulseAge < 1.25) {
            const progress = pulseAge / 1.25;
            const center = this.getSystemCenter();
            const radius =
                25 +
                (1 - Math.pow(1 - progress, 3)) *
                    Math.min(innerWidth, innerHeight) *
                    0.42;
            const alpha = Math.sin(progress * Math.PI) * 0.075 * layerStrength;

            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.beginPath();
            ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(220, 236, 255, ${alpha})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
            ctx.restore();
        }

        // Trails are vivid briefly, then become persistent ghost traces.
        for (const star of this.memory) {
            if (!star.path || star.path.length < 2) continue;

            const age = (now - star.born) / 1000;
            const pathLife = Math.max(0, 1 - age / 10);
            if (pathLife <= 0) continue;

            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.beginPath();

            for (let i = 0; i < star.path.length; i++) {
                const point = star.path[i];
                if (i === 0) ctx.moveTo(point.x, point.y);
                else ctx.lineTo(point.x, point.y);
            }

            const depthAlpha = 0.025 + (star.depth ?? 0.5) * 0.035;
            ctx.strokeStyle =
                `rgba(${this.hexToRgba(star.color, depthAlpha * pathLife * layerStrength)})`;
            ctx.lineWidth = 0.45 + (star.energy ?? 0) * 0.35;
            ctx.stroke();
            ctx.restore();
        }

        const visibleStars = this.memory.slice(-this.maxMemoryStars);
        const linked = new Set();

        // Nearby stars form persistent, low-contrast constellations.
        for (let i = 0; i < visibleStars.length; i++) {
            const a = visibleStars[i];
            const ageA = (now - a.born) / 1000;
            const presenceA = 0.20 + 0.80 * Math.exp(-ageA / 8);

            let nearest = null;
            let nearestDistance = Infinity;

            for (let j = 0; j < visibleStars.length; j++) {
                if (i === j) continue;

                const b = visibleStars[j];
                const distance = Math.hypot(b.x - a.x, b.y - a.y);

                if (distance < nearestDistance) {
                    nearest = b;
                    nearestDistance = distance;
                }
            }

            if (!nearest || nearestDistance > 250) continue;

            const pairKey = [a.born, nearest.born].sort().join(":");
            if (linked.has(pairKey)) continue;
            linked.add(pairKey);

            const ageB = (now - nearest.born) / 1000;
            const presenceB = 0.20 + 0.80 * Math.exp(-ageB / 8);
            const proximity = 1 - nearestDistance / 250;
            const alpha =
                0.055 *
                layerStrength *
                presenceA *
                presenceB *
                proximity;

            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(nearest.x, nearest.y);
            ctx.strokeStyle =
                `rgba(185, 205, 235, ${alpha})`;
            ctx.lineWidth = 0.55;
            ctx.stroke();
        }

        for (const star of visibleStars) {
            const age = (now - star.born) / 1000;
            const depth = star.depth ?? 0.5;

            // Stars never reach zero alpha: old memories remain as a faint sky.
            const settling = Math.exp(-age / 8);
            const presence =
                (0.18 + settling * 0.82) *
                layerStrength;

            const energy = Math.max(0, Math.min(1, star.energy ?? 0.5));
            const radius =
                0.65 +
                depth * 1.55 +
                energy * 1.15 +
                Math.min(1.6, star.duration * 0.30);

            if (energy > 0.45 || depth > 0.72) {
                ctx.beginPath();
                ctx.arc(
                    star.x,
                    star.y,
                    radius * (3.8 + depth * 2.2),
                    0,
                    Math.PI * 2
                );
                ctx.strokeStyle =
                    `rgba(${this.hexToRgba(star.color, 0.035 * presence)})`;
                ctx.lineWidth = 0.7;
                ctx.stroke();
            }

            ctx.beginPath();
            ctx.arc(star.x, star.y, radius, 0, Math.PI * 2);
            ctx.fillStyle =
                `rgba(${this.hexToRgba(star.color, 0.82 * presence)})`;
            ctx.fill();

            // Rare, slow twinkle.
            const twinkle = Math.pow(
                Math.max(
                    0,
                    Math.sin(now / (1800 + depth * 2200) + star.phase)
                ),
                12
            );

            if (twinkle > 0.72) {
                ctx.beginPath();
                ctx.arc(
                    star.x,
                    star.y,
                    radius * (2.4 + twinkle * 1.8),
                    0,
                    Math.PI * 2
                );
                ctx.strokeStyle =
                    `rgba(${this.hexToRgba(star.color, 0.07 * twinkle * presence)})`;
                ctx.lineWidth = 0.6;
                ctx.stroke();
            }
        }

        // No idle-dependent rendering here: stars remain visually continuous.
        /* if (false && visibleStars.length > 0) {
            const center = this.getSystemCenter();
            const breath = 0.5 + 0.5 * Math.sin(now / 5200);
            const radius =
                Math.min(innerWidth, innerHeight) *
                (0.28 + breath * 0.035);

            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.beginPath();
            ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
            ctx.strokeStyle =
                `rgba(210, 228, 250, ${0.018 + breath * 0.018})`;
            ctx.lineWidth = 0.7;
            ctx.stroke();
            ctx.restore();
        } */
    }

    drawConstellation(ctx, now, layerStrength = 1) {
        const stars = this.memory.slice(-this.maxMemoryStars);
        if (stars.length < 3) return;

        // Local connections let constellations emerge without creating a web.
        const maxDistance = 340;
        const maxNeighbors = 2;
        const linked = new Set();

        for (let i = 0; i < stars.length; i++) {
            const a = stars[i];
            const ageA = (now - a.born) / 1000;
            const presenceA = 0.18 + 0.82 * Math.exp(-ageA / 10);

            const neighbors = stars
                .filter((_, index) => index !== i)
                .map(b => ({
                    star: b,
                    distance: Math.hypot(b.x - a.x, b.y - a.y)
                }))
                .filter(entry => entry.distance < maxDistance)
                .sort((x, y) => x.distance - y.distance)
                .slice(0, maxNeighbors);

            for (const { star: b, distance } of neighbors) {
                const pairKey = [a.born, b.born].sort().join(":");
                if (linked.has(pairKey)) continue;
                linked.add(pairKey);

                const ageB = (now - b.born) / 1000;
                const presenceB = 0.18 + 0.82 * Math.exp(-ageB / 10);
                const proximity = 1 - distance / maxDistance;
                const depth = ((a.depth ?? 0.5) + (b.depth ?? 0.5)) * 0.5;
                const alpha =
                    0.085 *
                    layerStrength *
                    presenceA *
                    presenceB *
                    proximity *
                    (0.65 + depth * 0.35);

                if (alpha <= 0) continue;

                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.strokeStyle =
                    `rgba(205, 220, 240, ${alpha})`;
                ctx.lineWidth = 0.6 + proximity * 0.35;
                ctx.stroke();
            }
        }
    }

    drawIdle(now) {
        const idle = now - this.lastInteraction > 15000;
        const idleMessage = document.getElementById("idle-message");
        const idleMessageText = document.getElementById("idle-message-text");
        const idleHands = document.getElementById("idle-hands");

        if (!idle) {
            this.sleepCycle = -1;

            if (idleMessage) {
                idleMessage.classList.remove("visible");
            }

            if (idleHands) {
                idleHands.classList.remove("visible");
            }

            return false;
        }

        if (this.sleepCycle === -1) {
            this.sleepCycle = 0;

            const messages = [
                "RÉVEILLEZ-MOI",
                "JE SUIS LÀ",
                "HEY"
            ];

            this.sleepMessageIndex =
                (this.sleepMessageIndex + 1) % messages.length;

            if (idleMessageText) {
                idleMessageText.textContent =
                    messages[this.sleepMessageIndex];
            }
        }

        if (idleMessage) {
            idleMessage.classList.add("visible");
        }

        if (idleHands) {
            idleHands.classList.add("visible");
        }

        return true;
    }

    indexHue(phase) {
        return ((phase * 95) % 300 + 300) % 300;
    }


    drawActiveBodies(ctx, now) {
        const items = [...this.active.values()];
        const liveItems = items.filter(item => !item.releasedAt);
        const oldestBorn = liveItems.length
            ? Math.min(...liveItems.map(item => item.born))
            : now;
        const revealAge = Math.max(0, (now - oldestBorn) / 1000);
        const trailReveal = Math.min(
            1,
            Math.max(0, (revealAge - 1.5) / 8)
        );
        const trailRevealEase =
            trailReveal * trailReveal * (3 - 2 * trailReveal);

        for (const item of items) {
            if (item.releasedAt && (item.releaseLife ?? 0) <= 0) {
                continue;
            }

            const holdAge = !item.releasedAt
                ? Math.max(0, (now - item.born) / 1000)
                : 0;
            const holdProgress = Math.min(
                1,
                Math.max(0, (holdAge - 2.8) / 2.6)
            );
            const holdEase =
                holdProgress * holdProgress * (3 - 2 * holdProgress);
            const unlockPulse = Math.max(
                0,
                1 - Math.abs(holdAge - 3.5) / 0.72
            );

            const radius =
                11 +
                item.velocity * 13 +
                (item.duration ? Math.min(item.duration, 3) * 1.8 : 0) +
                holdEase * 3.3;
            const holdRadius = radius / 3;

            const life = item.releaseLife;

            // The trajectory is now part of the instrument's memory.
            // Released bodies keep their inertia briefly, so their path can
            // continue after the note is released.
            if (Number.isFinite(item.x) && Number.isFinite(item.y)) {
                item.trail ??= [];

                const lastTrail =
                    item.trail[item.trail.length - 1];

                if (
                    !lastTrail ||
                    Math.hypot(
                        item.x - lastTrail.x,
                        item.y - lastTrail.y
                    ) > 5
                ) {
                    item.trail.push({
                        x: item.x,
                        y: item.y,
                        born: now
                    });
                }

                const style = this.getVisualStyle();
                const maxTrailAge = item.releasedAt
                    ? 5.2 * style.trail
                    : 8 * style.trail;

                item.trail = item.trail.filter(
                    point => (now - point.born) / 1000 < maxTrailAge
                );
            }

            if (item.trail?.length >= 2) {
                ctx.save();
                ctx.globalCompositeOperation = "lighter";
                ctx.beginPath();

                for (let i = 0; i < item.trail.length; i++) {
                    const point = item.trail[i];

                    if (i === 0) {
                        ctx.moveTo(point.x, point.y);
                    } else {
                        ctx.lineTo(point.x, point.y);
                    }
                }

                const style = this.getVisualStyle();
                const trailAlpha = item.releasedAt
                    ? 0.06 * life
                    : (0.035 + trailRevealEase * 0.20) *
                        life *
                        style.trail;

                ctx.strokeStyle =
                    `rgba(${this.hexToRgba(item.hue, trailAlpha)})`;
                ctx.lineWidth =
                    0.65 + item.velocity * 0.45;
                ctx.stroke();
                ctx.restore();
            }

            // Long contact unlocks a visible second state: the body
            // develops an orbital shell and starts bending the surrounding
            // space. A brief threshold pulse makes the transition unmistakable.
            if (!item.releasedAt && unlockPulse > 0) {
                ctx.save();
                ctx.globalCompositeOperation = "lighter";

                const burst = 1 - unlockPulse;
                const burstRadius = holdRadius * (1.7 + burst * 8);
                ctx.beginPath();
                ctx.ellipse(
                    item.x,
                    item.y,
                    burstRadius * 1.55,
                    burstRadius * 0.62,
                    item.phase + now / 900,
                    0,
                    Math.PI * 2
                );
                ctx.strokeStyle =
                    `rgba(${this.hexToRgba(item.hue, 0.16 * unlockPulse * life)})`;
                ctx.lineWidth = 0.8 + unlockPulse * 1.0;
                ctx.stroke();

                for (let ray = 0; ray < 10; ray++) {
                    const angle =
                        item.phase +
                        ray * (Math.PI * 2 / 10) +
                        now / 1800;
                    const inner = burstRadius * 0.72;
                    const outer = burstRadius * (1.05 + unlockPulse * 0.35);

                    ctx.beginPath();
                    ctx.moveTo(
                        item.x + Math.cos(angle) * inner,
                        item.y + Math.sin(angle) * inner * 0.68
                    );
                    ctx.lineTo(
                        item.x + Math.cos(angle) * outer,
                        item.y + Math.sin(angle) * outer * 0.68
                    );
                    ctx.strokeStyle =
                        `rgba(${this.hexToRgba(item.hue, 0.075 * unlockPulse * life)})`;
                    ctx.lineWidth = 0.55 + unlockPulse * 0.5;
                    ctx.stroke();
                }

                ctx.restore();
            }

            // Long contact unlocks a visible second state: the body
            // develops an orbital shell and starts bending the surrounding
            // space. It arrives slowly enough to feel like a discovery.
            if (!item.releasedAt && holdEase > 0) {
                ctx.save();
                ctx.globalCompositeOperation = "lighter";

                const shellRotation = now / 2600 + item.phase;
                const shellCount = 3;
                for (let shell = 0; shell < shellCount; shell++) {
                    const shellAngle =
                        shellRotation +
                        shell * (Math.PI * 2 / shellCount);

                    ctx.beginPath();
                    ctx.ellipse(
                        item.x,
                        item.y,
                        holdRadius * (4.6 + holdEase * 4.2),
                        holdRadius * (1.05 + holdEase * 1.7),
                        shellAngle,
                        0,
                        Math.PI * 2
                    );
                    ctx.strokeStyle =
                        `rgba(${this.hexToRgba(item.hue, (0.055 + holdEase * 0.10) * life)})`;
                    ctx.lineWidth = 0.7 + holdEase * 0.7;
                    ctx.stroke();
                }

                const pulse = 0.5 + 0.5 * Math.sin(now / 360 + item.phase);
                ctx.beginPath();
                ctx.arc(
                    item.x,
                    item.y,
                    holdRadius * (5.2 + holdEase * 3.8 + pulse * 1.8),
                    0,
                    Math.PI * 2
                );
                ctx.strokeStyle =
                    `rgba(${this.hexToRgba(item.hue, (0.035 + holdEase * 0.075) * life)})`;
                ctx.lineWidth = 1;
                ctx.stroke();

                // A small number of satellites appear only after the hold.
                for (let satellite = 0; satellite < 5; satellite++) {
                    const angle =
                        item.phase +
                        now / (1700 + satellite * 190) +
                        satellite * (Math.PI * 2 / 5);
                    const distance =
                        holdRadius * (4.8 + holdEase * 7);
                    const x =
                        item.x + Math.cos(angle) * distance;
                    const y =
                        item.y + Math.sin(angle) * distance * 0.72;

                    ctx.beginPath();
                    ctx.arc(
                        x,
                        y,
                        0.8 + holdEase * 1.1,
                        0,
                        Math.PI * 2
                    );
                    ctx.fillStyle =
                        `rgba(${this.hexToRgba(item.hue, (0.25 + holdEase * 0.48) * life)})`;
                    ctx.fill();
                }

                ctx.restore();
            }

            ctx.beginPath();
            ctx.arc(item.x, item.y, radius * 3.8, 0, Math.PI * 2);
            ctx.strokeStyle =
                `rgba(${this.hexToRgba(item.hue, (0.16 + holdEase * 0.10) * life)})`;
            ctx.lineWidth = 1 + holdEase * 0.4;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(item.x, item.y, radius, 0, Math.PI * 2);
            ctx.fillStyle =
                `rgba(${this.hexToRgba(item.hue, 0.92 * life)})`;
            ctx.fill();

            if (item.chaotic) {
                const satelliteAngle =
                    -item.angle - now / 1800;

                const distance = radius * 5;

                ctx.beginPath();
                ctx.arc(
                    item.x + Math.cos(satelliteAngle) * distance,
                    item.y + Math.sin(satelliteAngle) * distance,
                    1.6,
                    0,
                    Math.PI * 2
                );
                ctx.fillStyle =
                    `rgba(${this.hexToRgba(item.hue, 0.72 * life)})`;
                ctx.fill();
            }

            if (life < 1) {
                ctx.beginPath();
                ctx.arc(
                    item.x,
                    item.y,
                    radius * (1 + (1 - life) * 7),
                    0,
                    Math.PI * 2
                );
                ctx.strokeStyle =
                    `rgba(${this.hexToRgba(item.hue, 0.22 * life)})`;
                ctx.stroke();
            }
        }

        // A chord becomes a short-lived celestial event:
        // encounter -> constellation -> geometric formation -> release.

        if (liveItems.length >= 2) {
            const center = this.getSystemCenter();
            const chordAge = this.chordStartedAt
                ? (now - this.chordStartedAt) / 1000
                : 10;

            if (chordAge >= 0 && chordAge < 4.8) {
                const impact = Math.max(0, 1 - chordAge / 4.8);
                const pulse =
                    Math.sin(chordAge * Math.PI * 2.6) * 0.5 + 0.5;
                const strength =
                    Math.min(1, (this.chordSize - 1) / 4);

                // The center is intentionally almost empty: the energy
                // is carried by lines, rings and escaping particles.
                const formation =
                    Math.min(1, chordAge / 0.55);
                const formationEase =
                    formation * formation * (3 - 2 * formation);

                const ordered = [...liveItems].sort(
                    (a, b) => a.note - b.note
                );

                // Rotating constellation geometry.
                if (ordered.length >= 2) {
                    const rotation =
                        chordAge * (0.45 + this.chordSize * 0.08);
                    const radius =
                        ordered.length === 2
                            ? 105
                            : 88 + ordered.length * 18;

                    ctx.save();
                    ctx.globalCompositeOperation = "lighter";
                    ctx.setLineDash([
                        4 + pulse * 5,
                        10 + (1 - pulse) * 9
                    ]);
                    ctx.lineDashOffset = -chordAge * 42;

                    for (let i = 0; i < ordered.length; i++) {
                        const a = ordered[i];
                        const b = ordered[(i + 1) % ordered.length];

                        const alpha =
                            (0.20 + strength * 0.18) *
                            impact *
                            formationEase;

                        ctx.beginPath();
                        ctx.moveTo(a.x, a.y);
                        ctx.lineTo(b.x, b.y);
                        ctx.strokeStyle =
                            `rgba(220, 236, 255, ${alpha})`;
                        ctx.lineWidth =
                            0.9 + strength * 1.25;
                        ctx.stroke();
                    }

                    ctx.setLineDash([]);
                    ctx.restore();
                }

                // Three interlaced rings travel through the constellation.
                const ringCount =
                    this.chordSize >= 5 ? 4 :
                    this.chordSize >= 3 ? 3 : 2;

                for (let ring = 0; ring < ringCount; ring++) {
                    const delay = ring * 0.22;
                    const ringAge = Math.max(0, chordAge - delay);

                    if (ringAge > 2.7) continue;

                    const ringProgress =
                        Math.min(1, ringAge / 2.7);
                    const radius =
                        28 +
                        ringProgress *
                            (180 + strength * 210) +
                        Math.sin(ringAge * 4 + ring) * 8;
                    const alpha =
                        (0.14 + pulse * 0.05) *
                        (1 - ringProgress) *
                        impact;

                    ctx.beginPath();
                    ctx.arc(
                        center.x,
                        center.y,
                        radius,
                        0,
                        Math.PI * 2
                    );
                    ctx.strokeStyle =
                        `hsla(${198 + ring * 27}, 70%, 84%, ${alpha})`;
                    ctx.lineWidth =
                        0.8 + strength * 0.8;
                    ctx.stroke();
                }

                // A brief gravitational "lens" at the center.
                // It is a tiny breathing point, not a central blob.
                const coreRadius =
                    2.5 +
                    pulse * 4 +
                    strength * 3;
                ctx.beginPath();
                ctx.arc(
                    center.x,
                    center.y,
                    coreRadius,
                    0,
                    Math.PI * 2
                );
                ctx.fillStyle =
                    `rgba(238, 246, 255, ${0.18 * impact})`;
                ctx.fill();

                // Particles escape from the barycenter as the chord opens.
                ctx.save();
                ctx.globalCompositeOperation = "lighter";

                for (const particle of this.chordParticles) {
                    const age =
                        chordAge -
                        particle.offset;

                    if (age <= 0 || age >= particle.life) continue;

                    const progress =
                        Math.min(1, age / particle.life);
                    const eased =
                        1 - Math.pow(1 - progress, 3);

                    const localAngle =
                        particle.angle +
                        Math.sin(age * 1.7) * 0.08;

                    const distance =
                        eased *
                        particle.speed *
                        (0.75 + strength * 0.55);

                    const x =
                        center.x +
                        Math.cos(localAngle) * distance;
                    const y =
                        center.y +
                        Math.sin(localAngle) *
                            distance *
                            0.72;

                    const alpha =
                        Math.sin(
                            Math.min(
                                1,
                                progress * Math.PI
                            )
                        ) *
                        0.52 *
                        impact;

                    ctx.beginPath();
                    ctx.arc(
                        x,
                        y,
                        particle.size *
                            (1 + strength * 0.45),
                        0,
                        Math.PI * 2
                    );
                    ctx.fillStyle =
                        `hsla(${particle.hue}, 68%, 82%, ${alpha})`;
                    ctx.fill();
                }

                ctx.restore();

                // At higher chord counts, ghost the constellation once
                // more, slightly rotated: the geometry appears to split
                // into multiple possible orbits.
                if (ordered.length >= 4 && formationEase > 0.15) {
                    const ghostRotation =
                        rotation +
                        0.13 +
                        Math.sin(chordAge * 1.2) * 0.04;

                    const ghostRadius =
                        (88 + ordered.length * 18) *
                        (1.04 + Math.sin(chordAge * 1.8) * 0.04);

                    ctx.save();
                    ctx.globalCompositeOperation = "lighter";
                    ctx.beginPath();

                    for (let i = 0; i < ordered.length; i++) {
                        const angle =
                            ghostRotation +
                            (i / ordered.length) *
                                Math.PI * 2;

                        const x =
                            center.x +
                            Math.cos(angle) * ghostRadius;
                        const y =
                            center.y +
                            Math.sin(angle) *
                                ghostRadius *
                                0.68;

                        if (i === 0) {
                            ctx.moveTo(x, y);
                        } else {
                            ctx.lineTo(x, y);
                        }
                    }

                    ctx.closePath();
                    ctx.strokeStyle =
                        `rgba(190, 220, 255, ${0.08 * impact})`;
                    ctx.lineWidth = 0.8;
                    ctx.stroke();
                    ctx.restore();
                }
            }
        }
    }

    frame() {
        if (!this.running) return;

        const ctx = this.ctx;
        if (!ctx) return;

        const now = performance.now();
        const idle = now - this.lastInteraction > 15000;

        try {
            const ratio = Math.min(
                Math.max(window.devicePixelRatio || 1, 1),
                2
            );

            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = "source-over";
            ctx.clearRect(0, 0, innerWidth, innerHeight);

            this.updateActiveBodies(now);
            this.drawMemory(ctx, now);
            this.drawConstellation(ctx, now);
            this.drawActiveBodies(ctx, now);

            this.lastFrameError = 0;
        } catch (error) {
            // A UI/DOM error must never leave the canvas blank.
            // Memory stars are rendered independently from idle state.
            if (now - this.lastFrameError > 2000) {
                console.warn("[VISUALS] Frame recovered:", error);
                this.lastFrameError = now;
            }

            try {
                const ratio = Math.min(
                    Math.max(window.devicePixelRatio || 1, 1),
                    2
                );

                ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
                ctx.globalAlpha = 1;
                ctx.globalCompositeOperation = "source-over";
                ctx.setLineDash([]);
            } catch {
                // Ignore canvas recovery errors and keep the loop alive.
            }
        }

        // Idle UI is deliberately outside the canvas render transaction:
        // if the DOM overlay fails, the celestial memory remains visible.
        try {
            this.drawIdle(now);
        } catch (error) {
            if (now - this.lastFrameError > 2000) {
                console.warn("[VISUALS] Idle UI error:", error);
                this.lastFrameError = now;
            }
        }

        requestAnimationFrame(this.frame);
    }
}
