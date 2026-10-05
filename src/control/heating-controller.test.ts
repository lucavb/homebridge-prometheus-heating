import { describe, it, expect } from 'vitest';
import {
    evaluateControl,
    getInitialControllerState,
    type ControlInput,
    type ControlParams,
    type ControllerState,
} from './heating-controller.ts';

const OFF = 0;
const HEAT = 1;

const baseParams = {
    controlMode: 'hysteresis',
    hysteresisC: 1,
    maxTargetTemperatureC: 35,
    maxTemperatureC: 60,
    minOffMs: 60_000,
    minOnMs: 60_000,
    minTargetTemperatureC: 5,
    minTemperatureC: -20,
    pwmCycleMs: 300_000,
    staleAfterMs: 120_000,
} as const satisfies ControlParams;

const initialState = {
    lastOffAt: 0,
    lastOnAt: 0,
    pwmCycleStartMs: 0,
    relayOn: false,
} as const satisfies ControllerState;

function makeInput(overrides: Partial<ControlInput> = {}): ControlInput {
    return {
        mode: HEAT,
        nowMs: 200_000,
        sampleTempC: 19,
        sampleAgeMs: 1_000,
        targetC: 20,
        params: baseParams,
        state: { ...initialState },
        bypassMinCycles: false,
        ...overrides,
    };
}

describe('evaluateControl', () => {
    it('classifies a fresh in-range sample as ok and decides normally', () => {
        // Target 20, hysteresis 1 → low threshold 19; 18.5 is below → on.
        const decision = evaluateControl(makeInput({ sampleTempC: 18.5, sampleAgeMs: 1_000 }));
        expect(decision.health).toBe('ok');
        expect(decision.relayOn).toBe(true);
    });

    it('returns relay off with health missing when the sample is null', () => {
        const decision = evaluateControl(makeInput({ sampleTempC: null, sampleAgeMs: 1_000 }));
        expect(decision.health).toBe('missing');
        expect(decision.relayOn).toBe(false);
        expect(decision.state.relayOn).toBe(false);
    });

    it('returns relay off with health stale when the sample age is infinite (no usable timestamp)', () => {
        // The room controller derives Infinity for timestampMs=0 samples; the pure
        // module only sees age. That sentinel derivation is pinned end-to-end in
        // room-controller.test.ts.
        const decision = evaluateControl(makeInput({ sampleTempC: 18.5, sampleAgeMs: Number.POSITIVE_INFINITY }));
        expect(decision.health).toBe('stale');
        expect(decision.relayOn).toBe(false);
        expect(decision.state.relayOn).toBe(false);
        expect(decision.clampedTargetC).toBe(20);
    });

    it('returns relay off with health missing when temp is null even with infinite age', () => {
        const decision = evaluateControl(makeInput({ sampleTempC: null, sampleAgeMs: Number.POSITIVE_INFINITY }));
        expect(decision.health).toBe('missing');
        expect(decision.relayOn).toBe(false);
    });

    it('returns relay off with health stale when the sample is older than staleAfterMs', () => {
        // 121_000 > staleAfterMs (120_000)
        const decision = evaluateControl(makeInput({ sampleTempC: 18.5, sampleAgeMs: 121_000 }));
        expect(decision.health).toBe('stale');
        expect(decision.relayOn).toBe(false);
    });

    it('classifies a stale out-of-range sample as stale (stale wins over invalid)', () => {
        const decision = evaluateControl(makeInput({ sampleTempC: 100, sampleAgeMs: Number.POSITIVE_INFINITY }));
        expect(decision.health).toBe('stale');
        expect(decision.relayOn).toBe(false);
    });

    it('returns relay off with health invalid for an out-of-range temperature, clampedTargetC still returned', () => {
        const decision = evaluateControl(makeInput({ sampleTempC: 100, sampleAgeMs: 1_000 }));
        expect(decision.health).toBe('invalid');
        expect(decision.relayOn).toBe(false);
        expect(decision.state.relayOn).toBe(false);
        expect(decision.clampedTargetC).toBe(20);
    });

    it('returns relay off with health invalid for a non-finite temperature', () => {
        const decision = evaluateControl(makeInput({ sampleTempC: Number.NaN, sampleAgeMs: 1_000 }));
        expect(decision.health).toBe('invalid');
        expect(decision.relayOn).toBe(false);
    });

    it('keeps relay on during min-on period even if temp reaches high', () => {
        const high = 20 + baseParams.hysteresisC;
        const stateJustTurnedOn = {
            ...initialState,
            lastOnAt: 190_000,
            relayOn: true,
        } as const satisfies ControllerState;
        const decision = evaluateControl(
            makeInput({ sampleTempC: high, sampleAgeMs: 1_000, state: stateJustTurnedOn }),
        );
        expect(decision.health).toBe('ok');
        expect(decision.relayOn).toBe(true);
        expect(decision.clampedTargetC).toBe(20);
    });

    it('PWM mode: relay on when position below duty and min-off satisfied', () => {
        const pwmParams = {
            ...baseParams,
            controlMode: 'pwm',
            minOffMs: 1000,
            pwmCycleMs: 1000,
        } as const satisfies ControlParams;
        const low = 20 - pwmParams.hysteresisC;
        const high = 20 + pwmParams.hysteresisC;
        const now = 5000;
        const cycleStart = now - 100;
        const state = {
            ...initialState,
            lastOffAt: now - 2000,
            pwmCycleStartMs: cycleStart,
        } as const satisfies ControllerState;
        const temp = (low + high) / 2 - 0.1;
        const decision = evaluateControl(
            makeInput({ sampleTempC: temp, sampleAgeMs: 1_000, nowMs: now, params: pwmParams, state }),
        );
        expect(decision.relayOn).toBe(true);
        expect(decision.state.pwmCycleStartMs).toBe(cycleStart);
    });

    it('PWM mode: restarts the cycle when the previous cycle has fully elapsed', () => {
        const pwmParams = {
            ...baseParams,
            controlMode: 'pwm',
            minOffMs: 1000,
            pwmCycleMs: 1000,
        } as const satisfies ControlParams;
        const now = 5000;
        // Last cycle started 1000ms ago → fully elapsed → must restart at now.
        const state = {
            ...initialState,
            lastOffAt: 3000,
            pwmCycleStartMs: 4000,
        } as const satisfies ControllerState;
        // Mid-band temp → duty 0.5; at the new cycle start pos=0 < duty → on.
        const decision = evaluateControl(
            makeInput({ sampleTempC: 20, sampleAgeMs: 1_000, nowMs: now, params: pwmParams, state }),
        );
        expect(decision.relayOn).toBe(true);
        expect(decision.state.pwmCycleStartMs).toBe(now);
    });
});

describe('evaluateControl: OFF mode', () => {
    it('forces relay off, sets lastOffAt to now when previously on, and leaves pwmCycleStartMs untouched', () => {
        const now = 200_000;
        const stateRelayOn: ControllerState = {
            lastOffAt: 0,
            lastOnAt: now - 10_000,
            pwmCycleStartMs: 555,
            relayOn: true,
        };
        const decision = evaluateControl(
            makeInput({
                mode: OFF,
                nowMs: now,
                state: stateRelayOn,
                // A cold sample must not turn the relay on either.
                sampleTempC: 1,
            }),
        );
        expect(decision.relayOn).toBe(false);
        expect(decision.state.relayOn).toBe(false);
        expect(decision.state.lastOffAt).toBe(now);
        expect(decision.state.lastOnAt).toBe(now - 10_000);
        expect(decision.state.pwmCycleStartMs).toBe(555);
        expect(decision.clampedTargetC).toBeUndefined();
        expect(decision.health).toBe('ok');
    });

    it('keeps lastOffAt unchanged when the relay was already off', () => {
        const now = 200_000;
        const stateRelayOff: ControllerState = {
            ...initialState,
            lastOffAt: 123,
        };
        const decision = evaluateControl(makeInput({ mode: OFF, nowMs: now, state: stateRelayOff }));
        expect(decision.relayOn).toBe(false);
        expect(decision.state.lastOffAt).toBe(123);
        expect(decision.clampedTargetC).toBeUndefined();
    });

    it('stays off with bypassMinCycles even with a cold sample', () => {
        const decision = evaluateControl(
            makeInput({
                mode: OFF,
                sampleTempC: 1,
                sampleAgeMs: 1_000,
                bypassMinCycles: true,
            }),
        );
        expect(decision.relayOn).toBe(false);
        expect(decision.state.relayOn).toBe(false);
        expect(decision.clampedTargetC).toBeUndefined();
    });

    it('still reports health classification in OFF mode', () => {
        const decision = evaluateControl(makeInput({ mode: OFF, sampleTempC: null }));
        expect(decision.health).toBe('missing');
        const decision2 = evaluateControl(
            makeInput({ mode: OFF, sampleTempC: 18.5, sampleAgeMs: Number.POSITIVE_INFINITY }),
        );
        expect(decision2.health).toBe('stale');
    });

    it('reports invalid health in OFF mode for an out-of-range temperature', () => {
        const decision = evaluateControl(makeInput({ mode: OFF, sampleTempC: 100, sampleAgeMs: 1_000 }));
        expect(decision.health).toBe('invalid');
        expect(decision.relayOn).toBe(false);
        expect(decision.state.relayOn).toBe(false);
        expect(decision.clampedTargetC).toBeUndefined();
    });
});

describe('evaluateControl: target clamping', () => {
    it('clamps a target below minTargetTemperatureC up and applies hysteresis around the clamped target', () => {
        // Clamped target 18 → low threshold 17.
        const low = 18 - baseParams.hysteresisC;
        const decision = evaluateControl(
            makeInput({
                targetC: 10,
                params: { ...baseParams, minTargetTemperatureC: 18, maxTargetTemperatureC: 35 },
                sampleTempC: low - 0.5,
                sampleAgeMs: 1_000,
            }),
        );
        expect(decision.clampedTargetC).toBe(18);
        expect(decision.health).toBe('ok');
        expect(decision.relayOn).toBe(true);
    });

    it('does not turn on above the low threshold of the clamped target', () => {
        const decision = evaluateControl(
            makeInput({
                targetC: 10,
                params: { ...baseParams, minTargetTemperatureC: 18, maxTargetTemperatureC: 35 },
                sampleTempC: 17.5,
                sampleAgeMs: 1_000,
            }),
        );
        expect(decision.relayOn).toBe(false);
    });

    it('clamps a target above maxTargetTemperatureC down and applies hysteresis around the clamped target', () => {
        // Clamped target 24 → high threshold 25.
        const high = 24 + baseParams.hysteresisC;
        const stateRelayOn: ControllerState = {
            ...initialState,
            relayOn: true,
            lastOnAt: 99_000,
        };
        const decision = evaluateControl(
            makeInput({
                targetC: 30,
                params: { ...baseParams, maxTargetTemperatureC: 24 },
                sampleTempC: high,
                sampleAgeMs: 1_000,
                state: stateRelayOn,
            }),
        );
        expect(decision.clampedTargetC).toBe(24);
        expect(decision.relayOn).toBe(false);
    });

    it('leaves an in-range target unclamped', () => {
        const decision = evaluateControl(makeInput({ targetC: 21, sampleAgeMs: 1_000 }));
        expect(decision.clampedTargetC).toBe(21);
    });
});

describe('evaluateControl: timestamp writes across sequential decisions', () => {
    it('writes lastOnAt on turn-on and lastOffAt on turn-off without swapping them', () => {
        const now1 = 200_000;
        const decision1 = evaluateControl(
            makeInput({ sampleTempC: 18.5, sampleAgeMs: 1_000, nowMs: now1, bypassMinCycles: true }),
        );
        expect(decision1.relayOn).toBe(true);
        expect(decision1.state.lastOnAt).toBe(now1);
        expect(decision1.state.lastOffAt).toBe(0); // unchanged initial value

        const now2 = 260_000;
        const decision2 = evaluateControl(
            makeInput({
                sampleTempC: 21.5, // above the high threshold → desired off
                sampleAgeMs: 1_000,
                nowMs: now2,
                state: decision1.state,
                bypassMinCycles: true, // min-on (60s > 60s gap) would otherwise hold the relay on
            }),
        );
        expect(decision2.relayOn).toBe(false);
        expect(decision2.state.lastOffAt).toBe(now2);
        expect(decision2.state.lastOnAt).toBe(now1);
    });
});

describe('evaluateControl: bypassMinCycles', () => {
    it('turns relay on immediately even when minOffMs is not satisfied', () => {
        const stateJustTurnedOff: ControllerState = {
            ...initialState,
            relayOn: false,
            lastOffAt: 199_000, // only 1s ago, minOffMs = 60_000
        };
        const decision = evaluateControl(
            makeInput({
                sampleTempC: 20 - baseParams.hysteresisC - 0.5, // below low threshold
                state: stateJustTurnedOff,
                bypassMinCycles: true,
            }),
        );
        expect(decision.relayOn).toBe(true);
    });

    it('turns relay off immediately even when minOnMs is not satisfied', () => {
        const stateJustTurnedOn: ControllerState = {
            ...initialState,
            relayOn: true,
            lastOnAt: 199_000, // only 1s ago, minOnMs = 60_000
        };
        const decision = evaluateControl(
            makeInput({
                sampleTempC: 20 + baseParams.hysteresisC + 0.5, // above high threshold
                state: stateJustTurnedOn,
                bypassMinCycles: true,
            }),
        );
        expect(decision.relayOn).toBe(false);
    });

    it('still forces relay off when the sample is stale even with bypassMinCycles', () => {
        const stateJustTurnedOff: ControllerState = {
            ...initialState,
            relayOn: false,
            lastOffAt: 199_000,
        };
        const decision = evaluateControl(
            makeInput({
                sampleTempC: 15, // below threshold
                sampleAgeMs: Number.POSITIVE_INFINITY, // stale age
                state: stateJustTurnedOff,
                bypassMinCycles: true,
            }),
        );
        expect(decision.health).toBe('stale');
        expect(decision.relayOn).toBe(false);
    });
});

describe('evaluateControl: min cycles', () => {
    it('blocks turning on while minOffMs is not satisfied', () => {
        const stateJustTurnedOff: ControllerState = {
            ...initialState,
            relayOn: false,
            lastOffAt: 190_000,
        };
        const decision = evaluateControl(makeInput({ sampleTempC: 18, state: stateJustTurnedOff }));
        expect(decision.relayOn).toBe(false);
    });
});

describe('evaluateControl: boundaries', () => {
    it('treats sampleAgeMs exactly equal to staleAfterMs as fresh', () => {
        const decision = evaluateControl(makeInput({ sampleTempC: 18.5, sampleAgeMs: 120_000 }));
        expect(decision.health).toBe('ok');
        expect(decision.relayOn).toBe(true);
    });

    it('does not turn on exactly at the low threshold', () => {
        const decision = evaluateControl(makeInput({ sampleTempC: 19, sampleAgeMs: 1_000 }));
        expect(decision.health).toBe('ok');
        expect(decision.relayOn).toBe(false);
    });

    it('treats min-cycle elapsed times exactly equal to minOnMs/minOffMs as satisfied', () => {
        // Turn-on: off for exactly minOffMs → gate opens.
        const stateOffExactlyLongEnough: ControllerState = {
            ...initialState,
            relayOn: false,
            lastOffAt: 140_000, // 200_000 - 140_000 = 60_000 === minOffMs
        };
        const turnOn = evaluateControl(
            makeInput({ sampleTempC: 18, sampleAgeMs: 1_000, state: stateOffExactlyLongEnough }),
        );
        expect(turnOn.relayOn).toBe(true);

        // Turn-off: on for exactly minOnMs → gate opens.
        const stateOnExactlyLongEnough: ControllerState = {
            ...initialState,
            relayOn: true,
            lastOnAt: 140_000, // 200_000 - 140_000 = 60_000 === minOnMs
        };
        const turnOff = evaluateControl(
            makeInput({ sampleTempC: 21.5, sampleAgeMs: 1_000, state: stateOnExactlyLongEnough }),
        );
        expect(turnOff.relayOn).toBe(false);
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
