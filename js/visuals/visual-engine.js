export class VisualEngine {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.canvas = null;
        this.ctx = null;

        this.active = new Map();
        this.memory = [];
        this.idleBodies = [];
        this.running = false;
        this.lastInteraction = performance.now();
        this.lastBloom = 0;
        this.chordStartedAt = 0;
        this.chordSize = 0;
        this.chordParticles = [];
        this.maxActiveBodies = 32;
        this.maxMemoryStars = 180;
        this.lastFrameError = 0;
        this.sleepCycle = -1;
        this.sleepMessageIndex = -1;
        this.interactionCount = 0;
        this.visualStyleIndex = 0;
        this.visualStyleChangedAt = performance.now();

        this.onNoteOn = this.onNoteOn.bind(this);
        this.onNoteOff = this.onNoteOff.bind(this);
        this.onScaleChange = this.onScaleChange.bind(this);
        this.frame = this.frame.bind(this);
        this.handleResize = this.handleResize.bind(this);

        eventBus.on("noteon", this.onNoteOn);
        eventBus.on("noteoff", this.onNoteOff);
        eventBus.on("scalechange", this.onScaleChange);
    }

    start() {
        this.canvas = document.createElement("canvas");
        this.canvas.className = "visual-field";
        this.canvas.setAttribute("aria-hidden", "true");
        document.body.prepend(this.canvas);

        this.ctx = this.canvas.getContext("2d");
        this.resize();

        window.addEventListener("resize", this.handleResize);

        this.createIdleBodies();
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

    createIdleBodies() {
        this.idleBodies = Array.from({ length: 12 }, (_, index) => ({
            angle: index * (Math.PI * 2 / 12),
            radius: 105 + index * 46,
            speed: 0.014 + index * 0.0028,
            size: 2.8 + (index % 4) * 1.1,
            phase: index * 1.37
        }));
    }

    getBodyId(event) {
        return `${event.source}-${event.channel}-${event.note}`;
    }

    onScaleChange(event) {
        if (!Number.isFinite(event?.index)) return;

        this.visualStyleIndex =
            ((event.index % 3) + 3) % 3;

        this.visualStyleChangedAt = performance.now();
        this.lastInteraction = performance.now();
    }

    getVisualStyle() {
        const styles = [
            {
                palette: ["#61E7FF", "#FF6B8A", "#B58CFF", "#7CFFB2", "#FFD166", "#F5F7FF", "#4DA6FF"],
                saturation: 78,
                lightness: 76,
                insideForce: 0.065,
                drag: 0.9992,
                maxSpeed: 1,
                trail: 1
            },
            {
                palette: ["#9B5DE5", "#F15BB5", "#00BBF9", "#00F5D4", "#FEE440", "#FF8A5B", "#E8D7FF"],
                saturation: 82,
                lightness: 70,
                insideForce: 0.050,
                drag: 0.9987,
                maxSpeed: 0.88,
                trail: 1.35
            },
            {
                palette: ["#FFD166", "#06D6A0", "#118AB2", "#EF476F", "#9B5DE5", "#F8F7FF", "#FF9F1C"],
                saturation: 86,
                lightness: 78,
                insideForce: 0.075,
                drag: 0.9995,
                maxSpeed: 1.12,
                trail: 0.78
            }
        ];

        return styles[this.visualStyleIndex] ?? styles[0];
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
            x: innerWidth * (0.5 + Math.sin(event.note * 1.73) * 0.25),
            y: innerHeight * (0.47 + Math.cos(event.note * 1.17) * 0.20),
            vx: Math.cos(event.note * 0.83) * 18,
            vy: Math.sin(event.note * 0.61) * 18,
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

        const memoryIndex = this.memory.length;
        const seed = item.note * 12.9898 + memoryIndex * 78.233;
        const randomX = (Math.sin(seed) * 43758.5453) % 1;
        const randomY = (Math.sin(seed + 19.19) * 43758.5453) % 1;

        this.memory.push({
            x: innerWidth * (0.10 + Math.abs(randomX) * 0.80),
            y: innerHeight * (0.12 + Math.abs(randomY) * 0.72),
            born: performance.now(),
            note: item.note,
            duration: item.duration,
            energy: item.velocity,
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
                innerWidth * (0.5 + Math.sin(item.note * 1.73) * 0.25);
            const baseY =
                innerHeight * (0.47 + Math.cos(item.note * 1.17) * 0.20);

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
                    const force =
                        5200 *
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

                // A held system slowly reveals a precise geometric attractor.
                // The physics remains active; the longer the contact lasts,
                // the more clearly the trajectory resolves into a shape.
                if (!item.releasedAt && count >= 2) {
                    const formationAge = Math.max(
                        0,
                        (now - Math.min(...items.map(candidate => candidate.born))) / 1000
                    );
                    const formation = Math.min(1, Math.max(0, (formationAge - 1.8) / 8));
                    const easedFormation =
                        formation * formation * (3 - 2 * formation);
                    const liveItems = items.filter(candidate => !candidate.releasedAt);
                    const ordered = [...liveItems].sort((a, b) => a.note - b.note);
                    const index = ordered.indexOf(item);

                    if (index !== -1 && ordered.length >= 2) {
                        const centerX = center.x;
                        const centerY = center.y;
                        const rotation =
                            elapsed * (0.04 + noteProfile * 0.055);
                        const radiusBase =
                            Math.min(
                                innerWidth * 0.22,
                                190 + ordered.length * 12
                            );
                        const radiusX =
                            radiusBase *
                            (0.72 + noteProfile * 0.56);
                        const radiusY = radiusX * (0.68 + noteProfile * 0.08);
                        let targetX = centerX;
                        let targetY = centerY;

                        if (ordered.length === 2) {
                            const angle =
                                (index === 0 ? Math.PI : 0) +
                                noteProfile * Math.PI * 0.35;
                            targetX = centerX + Math.cos(angle + rotation) * radiusX;
                            targetY = centerY + Math.sin(angle + rotation) * radiusY;
                        } else if (ordered.length === 3) {
                            const angle =
                                rotation -
                                Math.PI / 2 +
                                index * (Math.PI * 2 / 3) +
                                noteProfile * Math.PI * 0.18;
                            targetX = centerX + Math.cos(angle) * radiusX;
                            targetY = centerY + Math.sin(angle) * radiusY;
                        } else if (ordered.length === 4) {
                            const angle =
                                Math.PI / 4 +
                                rotation +
                                index * (Math.PI / 2) +
                                noteProfile * Math.PI * 0.16;
                            targetX = centerX + Math.cos(angle) * radiusX;
                            targetY = centerY + Math.sin(angle) * radiusY;
                        } else {
                            const angle =
                                rotation * (1.2 + noteProfile * 1.0) +
                                index * (Math.PI * 2 / ordered.length) +
                                noteProfile * 0.35;
                            const spiralRadius =
                                radiusX *
                                (0.42 +
                                    index / Math.max(1, ordered.length - 1) * 0.58);
                            targetX = centerX + Math.cos(angle) * spiralRadius;
                            targetY = centerY + Math.sin(angle) * spiralRadius * 0.68;
                        }

                        const pull = 0.4 + easedFormation * 4.2;
                        item.x += (targetX - item.x) * pull * dt;
                        item.y += (targetY - item.y) * pull * dt;
                    }
                }

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
                const orbit =
                    118 -
                    noteProfile * 68 +
                    Math.min(age, 3) * (6 - noteProfile * 2);

                const angle =
                    item.angle +
                    age * (0.085 + noteProfile * 0.22);

                item.x = baseX + Math.cos(angle) * orbit;
                item.y = baseY + Math.sin(angle) * orbit * 0.62;
                item.chaotic = false;
            }

            if (item.releasedAt) {
                const releaseProgress =
                    Math.min(1, (now - item.releasedAt) / 7600);

                item.releaseLife =
                    1 - (releaseProgress * releaseProgress * (3 - 2 * releaseProgress));

                if (releaseProgress >= 1) {
                    this.active.delete(item.id);
                }
            } else {
                item.releaseLife = 1;
            }
        }
    }

    drawMemory(ctx, now) {
        const memoryLifetime = 120;
        const pathLifetime = 18;

        for (const star of this.memory) {
            if (!star.path || star.path.length < 2) continue;

            const age = (now - star.born) / 1000;
            const life = Math.max(0, 1 - age / pathLifetime);

            if (life <= 0) continue;

            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.beginPath();

            for (let i = 0; i < star.path.length; i++) {
                const point = star.path[i];

                if (i === 0) {
                    ctx.moveTo(point.x, point.y);
                } else {
                    ctx.lineTo(point.x, point.y);
                }
            }

            ctx.strokeStyle =
                `hsla(${this.getNoteHue(star.note || 48)}, 42%, 76%, ${0.045 * life})`;
            ctx.lineWidth = 0.7;
            ctx.stroke();
            ctx.restore();
        }

        const visibleStars = this.memory
            .filter(star => {
                const age = (now - star.born) / 1000;
                return age < memoryLifetime;
            })
            .slice(-this.maxMemoryStars);

        const linked = new Set();

        for (let i = 0; i < visibleStars.length; i++) {
            const a = visibleStars[i];
            const ageA = (now - a.born) / 1000;
            const lifeA = Math.max(0, 1 - ageA / memoryLifetime);

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
            const lifeB = Math.max(0, 1 - ageB / memoryLifetime);
            const alpha =
                0.10 *
                lifeA *
                lifeB *
                (1 - nearestDistance / 250);

            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(nearest.x, nearest.y);
            ctx.strokeStyle =
                `rgba(185, 205, 235, ${alpha})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
        }

        for (const star of this.memory) {
            const age = (now - star.born) / 1000;
            const life = Math.max(0, 1 - age / memoryLifetime);

            if (life <= 0) continue;

            const radius =
                1.4 +
                Math.min(1.8, star.duration * 0.38) +
                star.energy * 0.7;

            ctx.beginPath();
            ctx.arc(star.x, star.y, radius, 0, Math.PI * 2);
            ctx.fillStyle =
                `hsla(${this.getNoteHue(star.note || 48)}, 62%, 82%, ${0.72 * life})`;
            ctx.fill();

            if (star.duration > 1.4) {
                ctx.beginPath();
                ctx.arc(star.x, star.y, radius * 5.5, 0, Math.PI * 2);
                ctx.strokeStyle =
                    `hsla(${this.getNoteHue(star.note || 48)}, 52%, 78%, ${0.10 * life})`;
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }
    }

    drawIdle(ctx, now) {
        const idle = now - this.lastInteraction > 30000;
        const idleMessage = document.getElementById("idle-message");

        const elapsed = (now - this.lastInteraction) / 1000;
        const sleepElapsed = Math.max(0, elapsed - 30);

        // The galaxy is a permanent background layer. It must not depend on
        // whether a note is currently active.
        if (!idle) {
            this.sleepCycle = -1;

            if (idleMessage) {
                idleMessage.classList.remove("visible");
            }
        } else if (this.sleepCycle === -1) {
            this.sleepCycle = 0;

            const messages = [
                "RÉVEILLEZ-MOI",
                "JE SUIS LÀ",
                "HEY"
            ];

            this.sleepMessageIndex =
                (this.sleepMessageIndex + 1) % messages.length;

            if (idleMessage) {
                idleMessage.textContent =
                    messages[this.sleepMessageIndex];
                idleMessage.classList.add("visible");
            }
        } else if (idleMessage) {
            idleMessage.classList.add("visible");
        }

        const elapsedAbsolute = now / 1000;
        const points = [];

        for (let index = 0; index < this.idleBodies.length; index++) {
            const body = this.idleBodies[index];
            const angle =
                body.angle +
                elapsedAbsolute * body.speed +
                Math.sin(elapsedAbsolute * 0.13 + body.phase) * 0.20;

            const x =
                innerWidth * (0.08 + (index % 4) * 0.28) +
                Math.sin(elapsedAbsolute * 0.11 + body.phase) * 55;
            const y =
                innerHeight * (0.16 + Math.floor(index / 4) * 0.34) +
                Math.cos(angle) * 48;

            // Keep these points readable during interaction. The
            // sleep message is the only thing that changes with idle state.
            const alpha =
                0.28 +
                0.08 * Math.sin(elapsedAbsolute * 0.55 + body.phase);

            const hue = (205 + body.phase * 58) % 360;
            points.push({ x, y, hue, body, alpha });

            ctx.beginPath();
            ctx.arc(x, y, body.size * 8, 0, Math.PI * 2);
            ctx.fillStyle =
                "hsla(" +
                hue +
                ", 65%, 75%, " +
                (alpha * 0.10) +
                ")";
            ctx.fill();

            ctx.beginPath();
            ctx.arc(x, y, body.size * 1.35, 0, Math.PI * 2);
            ctx.fillStyle =
                "hsla(" +
                hue +
                ", 62%, 82%, " +
                alpha +
                ")";
            ctx.fill();
        }

        for (let i = 0; i < points.length; i++) {
            let nearest = null;
            let nearestDistance = Infinity;

            for (let j = 0; j < points.length; j++) {
                if (i === j) continue;

                const distance = Math.hypot(
                    points[i].x - points[j].x,
                    points[i].y - points[j].y
                );

                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearest = points[j];
                }
            }

            if (!nearest || nearestDistance > 360) continue;

            ctx.beginPath();
            ctx.moveTo(points[i].x, points[i].y);
            ctx.lineTo(nearest.x, nearest.y);
            ctx.strokeStyle =
                "rgba(175, 195, 225, " +
                (0.16 * points[i].alpha * (1 - nearestDistance / 360)) +
                ")";
            ctx.lineWidth = 0.9;
            ctx.stroke();
        }
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
            const radius =
                11 +
                item.velocity * 13 +
                (item.duration ? Math.min(item.duration, 3) * 1.8 : 0);

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

            ctx.beginPath();
            ctx.arc(item.x, item.y, radius * 3.8, 0, Math.PI * 2);
            ctx.strokeStyle =
                `rgba(${this.hexToRgba(item.hue, 0.16 * life)})`;
            ctx.lineWidth = 1;
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
                    `hsla(${(item.hue + 35) % 360}, 62%, 64%, ${0.72 * life})`;
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

        try {
            ctx.clearRect(0, 0, innerWidth, innerHeight);

            this.updateActiveBodies(now);
            this.drawIdle(ctx, now);
            this.drawMemory(ctx, now);
            this.drawActiveBodies(ctx, now);

            this.lastFrameError = 0;
        } catch (error) {
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

        requestAnimationFrame(this.frame);
    }
}
