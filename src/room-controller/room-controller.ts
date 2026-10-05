import {
    evaluateControl,
    getInitialControllerState,
    type ControllerState,
    type SampleHealth,
} from '../control/heating-controller.ts';
import type { ShellyDriver } from '../shelly/shelly-driver.ts';
import { type RoomControllerOptions, type RoomControllerDeps, defaultRoomControllerDeps, HEAT, OFF } from './types.ts';

export function createRoomController(options: RoomControllerOptions): { start: () => void; stop: () => void } {
    const { log, prometheus, params, pollIntervalMs, logging, room, thermostat, persistedState, onStatePersist } =
        options;
    const deps: RoomControllerDeps =
        options.deps !== undefined ? { ...defaultRoomControllerDeps, ...options.deps } : defaultRoomControllerDeps;

    let shellyDriver: ShellyDriver | null = null;
    let controllerState: ControllerState = getInitialControllerState(persistedState?.relayOn, {
        now: () => deps.clock.now(),
    });
    let intervalId: ReturnType<(typeof deps.intervalScheduler)['setInterval']> | undefined;
    let lastSampleHealth: SampleHealth = 'ok';
    let lastAppliedRelayOn: boolean | undefined;

    let tickInProgress = false;
    let immediatePending = false;

    async function readSample(promQuery: string): Promise<{ tempC: number | null; lastSampleMs: number }> {
        const result = await prometheus.query(promQuery);
        return { tempC: result?.value ?? null, lastSampleMs: result?.timestampMs ?? 0 };
    }

    function logSampleHealthTransition(
        prevHealth: SampleHealth,
        nextHealth: SampleHealth,
        sampleAgeMs: number,
        tempC: number | null,
    ): void {
        if (nextHealth === prevHealth) {
            return;
        }
        if (nextHealth === 'missing') {
            log.warn(`[${room.id}] Prometheus returned no sample; forcing heating off.`);
        } else if (nextHealth === 'stale') {
            if (Number.isFinite(sampleAgeMs)) {
                log.warn(
                    `[${room.id}] Prometheus sample stale (${Math.round(sampleAgeMs / 1000)}s old); forcing heating off.`,
                );
            } else {
                log.warn(`[${room.id}] Prometheus sample stale (no timestamp); forcing heating off.`);
            }
        } else if (nextHealth === 'invalid') {
            log.warn(
                `[${room.id}] Temperature ${tempC} out of safe range (${params.minTemperatureC}..${params.maxTemperatureC}C); forcing heating off.`,
            );
        } else {
            log.info(`[${room.id}] Prometheus sample recovered.`);
        }
    }

    async function applyRelay(
        driver: ShellyDriver,
        relayOn: boolean,
        currentTempC: number | null,
        clampedTargetC: number | undefined,
    ): Promise<void> {
        try {
            await driver.setOn(relayOn);
            onStatePersist(room.id, relayOn);
            if (lastAppliedRelayOn !== relayOn) {
                const tempText = currentTempC === null ? 'n/a' : `${currentTempC.toFixed(2)}C`;
                const targetText = clampedTargetC !== undefined ? `${clampedTargetC.toFixed(2)}C` : 'off';
                log.info(`[${room.id}] Relay ${relayOn ? 'ON' : 'OFF'} (temp=${tempText}, target=${targetText}).`);
            }
            lastAppliedRelayOn = relayOn;
        } catch (e) {
            log.warn(`[${room.id}] Shelly setOn failed: ${String(e)}`);
        }
    }

    function updateThermostat(currentTempC: number | null, clampedTargetC: number | undefined, relayOn: boolean): void {
        if (currentTempC !== null) {
            thermostat.updateCurrentTemperature(currentTempC);
        }
        if (clampedTargetC !== undefined) {
            thermostat.updateTargetTemperature(clampedTargetC);
        }
        // TargetHeatingCoolingState is intentionally NOT written here — it is a
        // user-controlled setting and must not be overridden by the control loop.
        thermostat.updateCurrentHeatingCoolingState(relayOn ? HEAT : OFF);
    }

    async function tick(bypassMinCycles = false, userSetTargetC?: number, userSetMode?: number): Promise<void> {
        if (!shellyDriver) {
            return;
        }
        const driver = shellyDriver;

        const nowMs = deps.clock.now();

        // Read the user-requested mode. userSetMode bypasses the characteristic read
        // for the same reason as userSetTargetC: HAP-nodejs commits characteristic.value
        // only after callback() fires, but tick() runs synchronously up to the first
        // await — before callback() is called.
        const mode = userSetMode ?? thermostat.getTargetHeatingCoolingState();

        if (logging.logPromQueries) {
            log.debug(`[${room.id}] PromQL: ${room.promQuery}`);
        }

        const { tempC, lastSampleMs } = await readSample(room.promQuery);
        // The single staleness rule lives here: a sample without a usable
        // timestamp is treated as infinitely old; evaluateControl only sees age.
        const sampleAgeMs = lastSampleMs > 0 ? nowMs - lastSampleMs : Number.POSITIVE_INFINITY;

        const targetC = userSetTargetC ?? thermostat.getTargetTemperature();
        const decision = evaluateControl({
            mode,
            nowMs,
            sampleTempC: tempC,
            sampleAgeMs,
            targetC,
            params,
            state: controllerState,
            bypassMinCycles,
        });
        controllerState = decision.state;

        if (mode !== OFF) {
            logSampleHealthTransition(lastSampleHealth, decision.health, sampleAgeMs, tempC);
            lastSampleHealth = decision.health;
        }

        await applyRelay(driver, decision.relayOn, tempC, decision.clampedTargetC);

        updateThermostat(tempC, decision.clampedTargetC, decision.relayOn);

        if (logging.debug) {
            const tempText = tempC === null ? 'n/a' : `${tempC.toFixed(2)}C`;
            const ageText = Number.isFinite(sampleAgeMs) ? `${Math.round(sampleAgeMs / 1000)}s` : 'n/a';
            const targetText = decision.clampedTargetC !== undefined ? `${decision.clampedTargetC.toFixed(2)}C` : 'off';
            log.debug(
                `[${room.id}] tick temp=${tempText} target=${targetText} sampleAge=${ageText} mode=${mode === OFF ? 'off' : 'heat'} relay=${decision.relayOn ? 'on' : 'off'} bypass=${bypassMinCycles}`,
            );
        }
    }

    async function runTick(bypassMinCycles: boolean, userSetTargetC?: number, userSetMode?: number): Promise<void> {
        if (tickInProgress) {
            // Coalesce: remember an immediate is wanted so we re-run right after.
            if (bypassMinCycles) {
                immediatePending = true;
            }
            return;
        }
        tickInProgress = true;
        try {
            await tick(bypassMinCycles, userSetTargetC, userSetMode);
            // Drain at most one queued immediate to avoid unbounded recursion.
            // By the time this runs the HAP callback has been called and
            // characteristic.value is up-to-date, so no forced values are needed.
            if (immediatePending) {
                immediatePending = false;
                await tick(true);
            }
        } finally {
            tickInProgress = false;
        }
    }

    async function start(): Promise<void> {
        thermostat.setTargetTemperatureHandler((value) => {
            runTick(true, value).catch((e) => log.error(`[${room.id}] Immediate tick error: ${String(e)}`));
        });
        thermostat.setTargetHeatingCoolingStateHandler((value) => {
            runTick(true, undefined, value).catch((e) => log.error(`[${room.id}] Immediate tick error: ${String(e)}`));
        });

        try {
            shellyDriver = await deps.createShellyDriver(room.shelly);
        } catch (e) {
            log.error(`[${room.id}] Failed to create Shelly driver: ${String(e)}`);
            return;
        }
        log.info(
            `[${room.id}] Controller started (${room.shelly.host} switch ${room.shelly.switchId}, poll=${pollIntervalMs}ms).`,
        );
        await runTick(false);
        intervalId = deps.intervalScheduler.setInterval(() => {
            runTick(false).catch((e) => log.error(`[${room.id}] Tick error: ${String(e)}`));
        }, pollIntervalMs);
    }

    function stop(): void {
        if (intervalId !== undefined) {
            deps.intervalScheduler.clearInterval(intervalId);
            intervalId = undefined;
        }
        shellyDriver = null;
    }

    return {
        start: () => {
            start().catch((e) => log.error(`[${room.id}] Room controller error: ${String(e)}`));
        },
        stop,
    };
}
