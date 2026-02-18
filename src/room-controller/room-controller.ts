import { getInitialControllerState, type ControllerState } from '../control/heating-controller.ts';
import type { ShellyDriver } from '../shelly/shelly-driver.ts';
import { type RoomControllerOptions, type RoomControllerDeps, defaultRoomControllerDeps, OFF } from './types.ts';
import { mergeControlParams } from './merge-control-params.ts';
import { createPrometheusClientFromConfig } from './create-prometheus-client.ts';
import {
    readTemperature,
    evaluateSampleHealth,
    logSampleHealthTransition,
    decideRelay,
    applyRelay,
    updateThermostat,
    type SampleHealth,
} from './tick.ts';

export function createRoomController(options: RoomControllerOptions): { start: () => void; stop: () => void } {
    const { log, config, room, thermostat, persistedState, onStatePersist } = options;
    const deps: RoomControllerDeps =
        options.deps !== undefined ? { ...defaultRoomControllerDeps, ...options.deps } : defaultRoomControllerDeps;

    const prometheus = createPrometheusClientFromConfig(config, deps);
    const params = mergeControlParams(config.control, room);
    const pollIntervalMs = room.override?.pollIntervalMs ?? config.control.pollIntervalMs;

    let shellyDriver: ShellyDriver | null = null;
    let controllerState: ControllerState = getInitialControllerState(persistedState?.relayOn, {
        now: () => deps.clock.now(),
    });
    let intervalId: ReturnType<(typeof deps.intervalScheduler)['setInterval']> | undefined;
    let lastSampleHealth: SampleHealth = 'ok';
    let lastAppliedRelayOn: boolean | undefined;

    let tickInProgress = false;
    let immediatePending = false;

    async function tick(bypassMinCycles = false, userSetTargetC?: number, userSetMode?: number): Promise<void> {
        if (!shellyDriver) {
            return;
        }

        const nowMs = deps.clock.now();

        // Read the user-requested mode. userSetMode bypasses the characteristic read
        // for the same reason as userSetTargetC: HAP-nodejs commits characteristic.value
        // only after callback() fires, but tick() runs synchronously up to the first
        // await — before callback() is called.
        const mode = userSetMode ?? thermostat.getTargetHeatingCoolingState();

        if (config.logging.logPromQueries) {
            log.debug(`[${room.id}] PromQL: ${room.promQuery}`);
        }

        const { currentTempC, lastSampleMs, sampleAgeMs } = await readTemperature(prometheus, room.promQuery, nowMs);

        if (mode !== OFF) {
            const sampleHealth = evaluateSampleHealth(currentTempC, sampleAgeMs, params.staleAfterMs);
            logSampleHealthTransition(log, room.id, lastSampleHealth, sampleHealth, sampleAgeMs);
            lastSampleHealth = sampleHealth;
        }

        const targetC = userSetTargetC ?? thermostat.getTargetTemperature();
        const { relayOn, nextControllerState, clampedTargetC } = decideRelay({
            mode,
            nowMs,
            currentTempC,
            lastSampleMs,
            params,
            minTargetTemperatureC: room.minTargetTemperatureC,
            maxTargetTemperatureC: room.maxTargetTemperatureC,
            controllerState,
            targetC,
            bypassMinCycles,
        });
        controllerState = nextControllerState;

        lastAppliedRelayOn = await applyRelay({
            driver: shellyDriver,
            relayOn,
            roomId: room.id,
            onStatePersist,
            log,
            lastAppliedRelayOn,
            currentTempC,
            clampedTargetC,
        });

        updateThermostat(thermostat, currentTempC, clampedTargetC, relayOn);

        if (config.logging.debug) {
            const tempText = currentTempC === null ? 'n/a' : `${currentTempC.toFixed(2)}C`;
            const ageText = Number.isFinite(sampleAgeMs) ? `${Math.round(sampleAgeMs / 1000)}s` : 'n/a';
            const targetText = clampedTargetC !== undefined ? `${clampedTargetC.toFixed(2)}C` : 'off';
            log.debug(
                `[${room.id}] tick temp=${tempText} target=${targetText} sampleAge=${ageText} mode=${mode === OFF ? 'off' : 'heat'} relay=${relayOn ? 'on' : 'off'} bypass=${bypassMinCycles}`,
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
