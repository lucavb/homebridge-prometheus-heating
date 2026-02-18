import { describe, it, expect } from 'vitest';
import {
    evaluateHeatingState,
    getInitialControllerState,
    type ControlParams,
    type ControllerState,
} from './heating-controller.ts';

const baseParams = {
    controlMode: 'hysteresis',
    hysteresisC: 1,
    maxTemperatureC: 60,
    minOffMs: 60_000,
    minOnMs: 60_000,
    minTemperatureC: -20,
    pwmCycleMs: 300_000,
    staleAfterMs: 120_000,
    targetTemperatureC: 20,
} as const satisfies ControlParams;

const initialState = {
    lastOffAt: 0,
    lastOnAt: 0,
    pwmCycleStartMs: 0,
    relayOn: false,
} as const satisfies ControllerState;

describe('evaluateHeatingState', () => {
    it('returns relay off when sample is stale', () => {
        const now = 200_000;
        const lastSample = 0;
        const { relayOn, state } = evaluateHeatingState(now, 19, lastSample, baseParams, initialState);
        expect(relayOn).toBe(false);
        expect(state.relayOn).toBe(false);
    });

    it('returns relay off when current temperature is null', () => {
        const { relayOn } = evaluateHeatingState(1000, null, 0, baseParams, initialState);
        expect(relayOn).toBe(false);
    });

    it('turns on below low threshold in hysteresis mode when min-off satisfied', () => {
        const low = baseParams.targetTemperatureC - baseParams.hysteresisC;
        const now = 200_000;
        const stateWithMinOffSatisfied: ControllerState = {
            ...initialState,
            lastOffAt: now - 100_000,
        };
        const { relayOn } = evaluateHeatingState(now, low - 0.5, now - 1000, baseParams, stateWithMinOffSatisfied);
        expect(relayOn).toBe(true);
    });

    it('turns off at or above high threshold in hysteresis mode when min-on satisfied', () => {
        const high = baseParams.targetTemperatureC + baseParams.hysteresisC;
        const now = 200_000;
        const stateWithMinOnSatisfied: ControllerState = {
            ...initialState,
            relayOn: true,
            lastOnAt: now - 100_000,
        };
        const { relayOn } = evaluateHeatingState(now, high, now - 1000, baseParams, stateWithMinOnSatisfied);
        expect(relayOn).toBe(false);
    });

    it('returns relay off when temperature is out of valid range', () => {
        const { relayOn } = evaluateHeatingState(1000, 100, 0, baseParams, initialState);
        expect(relayOn).toBe(false);
    });

    it('keeps relay on during min-on period even if temp reaches high', () => {
        const high = baseParams.targetTemperatureC + baseParams.hysteresisC;
        const now = 200_000;
        const stateJustTurnedOn = {
            ...initialState,
            lastOnAt: now - 10_000,
            relayOn: true,
        } as const satisfies ControllerState;
        const { relayOn } = evaluateHeatingState(
            now,
            high,
            now - 1000,
            { ...baseParams, minOnMs: 60_000 },
            stateJustTurnedOn,
        );
        expect(relayOn).toBe(true);
    });

    it('PWM mode: relay on when position below duty and min-off satisfied', () => {
        const pwmParams = {
            ...baseParams,
            controlMode: 'pwm',
            hysteresisC: 1,
            minOffMs: 1000,
            pwmCycleMs: 1000,
            targetTemperatureC: 20,
        } as const satisfies ControlParams;
        const low = pwmParams.targetTemperatureC - pwmParams.hysteresisC;
        const high = pwmParams.targetTemperatureC + pwmParams.hysteresisC;
        const now = 5000;
        const cycleStart = now - 100;
        const state = {
            ...initialState,
            lastOffAt: now - 2000,
            pwmCycleStartMs: cycleStart,
        } as const satisfies ControllerState;
        const temp = (low + high) / 2 - 0.1;
        const { relayOn } = evaluateHeatingState(now, temp, now - 1000, pwmParams, state);
        expect(relayOn).toBe(true);
    });
});

describe('evaluateHeatingState bypassMinCycles', () => {
    it('turns relay on immediately even when minOffMs is not satisfied', () => {
        const now = 200_000;
        const stateJustTurnedOff: ControllerState = {
            ...initialState,
            relayOn: false,
            lastOffAt: now - 1_000, // only 1s ago, minOffMs = 60_000
        };
        const { relayOn } = evaluateHeatingState(
            now,
            baseParams.targetTemperatureC - baseParams.hysteresisC - 0.5, // below low threshold
            now - 1000,
            baseParams,
            stateJustTurnedOff,
            { bypassMinCycles: true },
        );
        expect(relayOn).toBe(true);
    });

    it('turns relay off immediately even when minOnMs is not satisfied', () => {
        const now = 200_000;
        const stateJustTurnedOn: ControllerState = {
            ...initialState,
            relayOn: true,
            lastOnAt: now - 1_000, // only 1s ago, minOnMs = 60_000
        };
        const { relayOn } = evaluateHeatingState(
            now,
            baseParams.targetTemperatureC + baseParams.hysteresisC + 0.5, // above high threshold
            now - 1000,
            baseParams,
            stateJustTurnedOn,
            { bypassMinCycles: true },
        );
        expect(relayOn).toBe(false);
    });

    it('still forces relay off when sample is stale even with bypassMinCycles', () => {
        const now = 200_000;
        const stateJustTurnedOff: ControllerState = {
            ...initialState,
            relayOn: false,
            lastOffAt: now - 1_000,
        };
        const { relayOn } = evaluateHeatingState(
            now,
            15, // below threshold
            0, // stale timestamp
            baseParams,
            stateJustTurnedOff,
            { bypassMinCycles: true },
        );
        expect(relayOn).toBe(false);
    });
});

describe('getInitialControllerState', () => {
    it('returns relay off when no restored state', () => {
        const state = getInitialControllerState();
        expect(state.relayOn).toBe(false);
    });

    it('returns relay on and lastOnAt set when restored relay was on', () => {
        const state = getInitialControllerState(true);
        expect(state.relayOn).toBe(true);
        expect(state.lastOnAt).toBeGreaterThan(0);
    });

    it('uses injected now() when deps provided', () => {
        const fixedNow = 12345;
        const state = getInitialControllerState(true, { now: () => fixedNow });
        expect(state.relayOn).toBe(true);
        expect(state.lastOnAt).toBe(fixedNow);
    });
});
