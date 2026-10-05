export type ControlMode = 'hysteresis' | 'pwm';

export type SampleHealth = 'ok' | 'missing' | 'stale' | 'invalid';

export interface ControlParams {
    controlMode: ControlMode;
    hysteresisC: number;
    maxTargetTemperatureC: number;
    maxTemperatureC: number;
    minOnMs: number;
    minOffMs: number;
    minTargetTemperatureC: number;
    minTemperatureC: number;
    pwmCycleMs: number;
    staleAfterMs: number;
}

export interface ControllerState {
    relayOn: boolean;
    lastOnAt: number;
    lastOffAt: number;
    pwmCycleStartMs: number;
}

const SAFE_DEFAULT_STATE: ControllerState = {
    relayOn: false,
    lastOnAt: 0,
    lastOffAt: 0,
    pwmCycleStartMs: 0,
};

const MODE_OFF = 0; // HAP TargetHeatingCoolingState.OFF

function isTemperatureValid(value: number, minC: number, maxC: number): boolean {
    return Number.isFinite(value) && value >= minC && value <= maxC;
}

export interface ControlInput {
    /** HAP mode constant: 0 = OFF, 1 = HEAT. */
    mode: number;
    nowMs: number;
    sampleTempC: number | null;
    /** Age of the sample in ms, as derived by the caller; Infinity = no usable timestamp. */
    sampleAgeMs: number;
    targetC: number;
    params: ControlParams;
    state: ControllerState;
    /**
     * When true, minOnMs / minOffMs are skipped. Use only for user-triggered
     * actions. Health force-off (missing/stale/invalid samples) still applies.
     */
    bypassMinCycles: boolean;
}

export interface ControlDecision {
    relayOn: boolean;
    state: ControllerState;
    clampedTargetC: number | undefined;
    health: SampleHealth;
}

function forcedOff(state: ControllerState, clampedTargetC: number | undefined, health: SampleHealth): ControlDecision {
    return { relayOn: false, state: { ...state, relayOn: false }, clampedTargetC, health };
}

export function evaluateControl(input: ControlInput): ControlDecision {
    const { mode, nowMs, params, state, bypassMinCycles } = input;
    // Bound once so the null-check below narrows the value for the whole
    // ok-path; re-reading input.sampleTempC would defeat control-flow analysis.
    const sampleTempC = input.sampleTempC;

    if (mode === MODE_OFF) {
        let health: SampleHealth;
        if (sampleTempC === null) {
            health = 'missing';
        } else if (input.sampleAgeMs > params.staleAfterMs) {
            health = 'stale';
        } else if (!isTemperatureValid(sampleTempC, params.minTemperatureC, params.maxTemperatureC)) {
            health = 'invalid';
        } else {
            health = 'ok';
        }
        return {
            relayOn: false,
            state: {
                ...state,
                relayOn: false,
                lastOffAt: state.relayOn ? nowMs : state.lastOffAt,
            },
            clampedTargetC: undefined,
            health,
        };
    }

    const clampedTargetC = Math.max(
        params.minTargetTemperatureC,
        Math.min(params.maxTargetTemperatureC, input.targetC),
    );

    // Health force-off comes before any min-cycle logic; bypassMinCycles does
    // not suppress it. Each case returns early so sampleTempC is narrowed to
    // number for the decision path below.
    if (sampleTempC === null) {
        return forcedOff(state, clampedTargetC, 'missing');
    }
    if (input.sampleAgeMs > params.staleAfterMs) {
        return forcedOff(state, clampedTargetC, 'stale');
    }
    if (!isTemperatureValid(sampleTempC, params.minTemperatureC, params.maxTemperatureC)) {
        return forcedOff(state, clampedTargetC, 'invalid');
    }

    const target = clampedTargetC;
    const low = target - params.hysteresisC;
    const high = target + params.hysteresisC;

    let workingState = state;
    let desiredOn: boolean;
    if (params.controlMode === 'hysteresis') {
        desiredOn = sampleTempC < low;
        const turnOffThreshold = high;
        if (workingState.relayOn && sampleTempC >= turnOffThreshold) {
            desiredOn = false;
        } else if (!workingState.relayOn && sampleTempC < low) {
            desiredOn = true;
        }
    } else {
        const duty = sampleTempC < low ? 1 : sampleTempC >= high ? 0 : (high - sampleTempC) / (high - low);
        let cycleStart = workingState.pwmCycleStartMs;
        const elapsed = nowMs - cycleStart;
        const cycleMs = params.pwmCycleMs;
        if (elapsed >= cycleMs || cycleStart === 0) {
            cycleStart = nowMs;
        }
        const pos = (nowMs - cycleStart) / cycleMs;
        desiredOn = pos < duty;
        workingState = { ...workingState, pwmCycleStartMs: cycleStart };
    }

    const minOnSatisfied = !workingState.relayOn || nowMs - workingState.lastOnAt >= params.minOnMs;
    const minOffSatisfied = workingState.relayOn || nowMs - workingState.lastOffAt >= params.minOffMs;

    let relayOn = desiredOn;
    if (!bypassMinCycles) {
        if (relayOn && !minOffSatisfied) {
            relayOn = false;
        }
        if (!relayOn && !minOnSatisfied) {
            relayOn = true;
        }
    }

    const nextState: ControllerState = {
        ...workingState,
        relayOn,
        lastOnAt: relayOn ? (workingState.relayOn ? workingState.lastOnAt : nowMs) : workingState.lastOnAt,
        lastOffAt: relayOn ? workingState.lastOffAt : workingState.relayOn ? nowMs : workingState.lastOffAt,
    };

    return { relayOn, state: nextState, clampedTargetC, health: 'ok' };
}

export interface GetInitialControllerStateDeps {
    now(): number;
}

export function getInitialControllerState(
    restoredRelayOn?: boolean,
    deps?: GetInitialControllerStateDeps,
): ControllerState {
    const now = deps?.now ?? (() => Date.now());
    if (restoredRelayOn === true) {
        return { ...SAFE_DEFAULT_STATE, relayOn: true, lastOnAt: now() };
    }
    return { ...SAFE_DEFAULT_STATE };
}
