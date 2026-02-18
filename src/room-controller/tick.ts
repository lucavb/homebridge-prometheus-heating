import type { Logging } from 'homebridge';
import type { PrometheusClient } from '../clients/prometheus-client.ts';
import type { ControllerState, ControlParams } from '../control/heating-controller.ts';
import { evaluateHeatingState } from '../control/heating-controller.ts';
import type { ShellyDriver } from '../shelly/shelly-driver.ts';
import type { RoomThermostatAccessory } from '../accessories/room-thermostat.ts';
import { HEAT, OFF } from './types.ts';

export type SampleHealth = 'ok' | 'missing' | 'stale';

export async function readTemperature(
    prometheus: PrometheusClient,
    promQuery: string,
    nowMs: number,
): Promise<{ currentTempC: number | null; lastSampleMs: number; sampleAgeMs: number }> {
    const result = await prometheus.query(promQuery);
    const currentTempC = result?.value ?? null;
    const lastSampleMs = result?.timestampMs ?? 0;
    const sampleAgeMs = lastSampleMs > 0 ? nowMs - lastSampleMs : Number.POSITIVE_INFINITY;
    return { currentTempC, lastSampleMs, sampleAgeMs };
}

export function evaluateSampleHealth(
    currentTempC: number | null,
    sampleAgeMs: number,
    staleAfterMs: number,
): SampleHealth {
    if (currentTempC === null) {
        return 'missing';
    }
    if (sampleAgeMs > staleAfterMs) {
        return 'stale';
    }
    return 'ok';
}

export function logSampleHealthTransition(
    log: Logging,
    roomId: string,
    prevHealth: SampleHealth,
    nextHealth: SampleHealth,
    sampleAgeMs: number,
): void {
    if (nextHealth === prevHealth) {
        return;
    }
    if (nextHealth === 'missing') {
        log.warn(`[${roomId}] Prometheus returned no sample; forcing heating off.`);
    } else if (nextHealth === 'stale') {
        log.warn(`[${roomId}] Prometheus sample stale (${Math.round(sampleAgeMs / 1000)}s old); forcing heating off.`);
    } else {
        log.info(`[${roomId}] Prometheus sample recovered.`);
    }
}

export interface DecideRelayOptions {
    mode: number;
    nowMs: number;
    currentTempC: number | null;
    lastSampleMs: number;
    params: ControlParams;
    minTargetTemperatureC: number;
    maxTargetTemperatureC: number;
    controllerState: ControllerState;
    targetC: number;
    bypassMinCycles: boolean;
}

export interface DecideRelayResult {
    relayOn: boolean;
    nextControllerState: ControllerState;
    clampedTargetC: number | undefined;
}

export function decideRelay(opts: DecideRelayOptions): DecideRelayResult {
    const {
        mode,
        nowMs,
        currentTempC,
        lastSampleMs,
        params,
        minTargetTemperatureC,
        maxTargetTemperatureC,
        controllerState,
        targetC,
        bypassMinCycles,
    } = opts;

    if (mode === OFF) {
        return {
            relayOn: false,
            nextControllerState: {
                ...controllerState,
                relayOn: false,
                lastOffAt: controllerState.relayOn ? nowMs : controllerState.lastOffAt,
            },
            clampedTargetC: undefined,
        };
    }

    const clampedTargetC = Math.max(minTargetTemperatureC, Math.min(maxTargetTemperatureC, targetC));
    const paramsWithTarget = { ...params, targetTemperatureC: clampedTargetC };
    const { relayOn, state: nextControllerState } = evaluateHeatingState(
        nowMs,
        currentTempC,
        lastSampleMs,
        paramsWithTarget,
        controllerState,
        { bypassMinCycles },
    );
    return { relayOn, nextControllerState, clampedTargetC };
}

export interface ApplyRelayOptions {
    driver: ShellyDriver;
    relayOn: boolean;
    roomId: string;
    onStatePersist: (roomId: string, relayOn: boolean) => void;
    log: Logging;
    lastAppliedRelayOn: boolean | undefined;
    currentTempC: number | null;
    clampedTargetC: number | undefined;
}

export async function applyRelay(opts: ApplyRelayOptions): Promise<boolean | undefined> {
    const { driver, relayOn, roomId, onStatePersist, log, currentTempC, clampedTargetC } = opts;
    let { lastAppliedRelayOn } = opts;
    try {
        await driver.setOn(relayOn);
        onStatePersist(roomId, relayOn);
        if (lastAppliedRelayOn !== relayOn) {
            const tempText = currentTempC === null ? 'n/a' : `${currentTempC.toFixed(2)}C`;
            const targetText = clampedTargetC !== undefined ? `${clampedTargetC.toFixed(2)}C` : 'off';
            log.info(`[${roomId}] Relay ${relayOn ? 'ON' : 'OFF'} (temp=${tempText}, target=${targetText}).`);
            lastAppliedRelayOn = relayOn;
        }
    } catch (e) {
        log.warn(`[${roomId}] Shelly setOn failed: ${String(e)}`);
    }
    return lastAppliedRelayOn;
}

export function updateThermostat(
    thermostat: RoomThermostatAccessory,
    currentTempC: number | null,
    clampedTargetC: number | undefined,
    relayOn: boolean,
): void {
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
