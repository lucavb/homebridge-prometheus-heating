export type ControlMode = 'hysteresis' | 'pwm';

export interface ControlParams {
    controlMode: ControlMode;
    targetTemperatureC: number;
    hysteresisC: number;
    minOnMs: number;
    minOffMs: number;
    pwmCycleMs: number;
    staleAfterMs: number;
    minTemperatureC: number;
    maxTemperatureC: number;
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

function isTemperatureValid(value: number, minC: number, maxC: number): boolean {
    return Number.isFinite(value) && value >= minC && value <= maxC;
}

export interface EvaluateHeatingStateOptions {
    /** When true, minOnMs / minOffMs are ignored. Use only for user-triggered actions. */
    bypassMinCycles?: boolean;
}

export function evaluateHeatingState(
    nowMs: number,
    currentTemperatureC: number | null,
    lastSampleTimestampMs: number,
    params: ControlParams,
    state: ControllerState,
    options?: EvaluateHeatingStateOptions,
): { relayOn: boolean; state: ControllerState } {
    const stale = nowMs - lastSampleTimestampMs > params.staleAfterMs;
    if (stale || currentTemperatureC === null) {
        return { relayOn: false, state: { ...state, relayOn: false } };
    }

    if (!isTemperatureValid(currentTemperatureC, params.minTemperatureC, params.maxTemperatureC)) {
        return { relayOn: false, state: { ...state, relayOn: false } };
    }

    const target = params.targetTemperatureC;
    const low = target - params.hysteresisC;
    const high = target + params.hysteresisC;

    let desiredOn: boolean;
    if (params.controlMode === 'hysteresis') {
        desiredOn = currentTemperatureC < low;
        const turnOffThreshold = high;
        if (state.relayOn && currentTemperatureC >= turnOffThreshold) {
            desiredOn = false;
        } else if (!state.relayOn && currentTemperatureC < low) {
            desiredOn = true;
        }
    } else {
        const duty =
            currentTemperatureC < low
                ? 1
                : currentTemperatureC >= high
                  ? 0
                  : (high - currentTemperatureC) / (high - low);
        let cycleStart = state.pwmCycleStartMs;
        const elapsed = nowMs - cycleStart;
        const cycleMs = params.pwmCycleMs;
        if (elapsed >= cycleMs || cycleStart === 0) {
            cycleStart = nowMs;
        }
        const pos = (nowMs - cycleStart) / cycleMs;
        desiredOn = pos < duty;
        state = { ...state, pwmCycleStartMs: cycleStart };
    }

    const minOnSatisfied = !state.relayOn || nowMs - state.lastOnAt >= params.minOnMs;
    const minOffSatisfied = state.relayOn || nowMs - state.lastOffAt >= params.minOffMs;

    let relayOn = desiredOn;
    if (!options?.bypassMinCycles) {
        if (relayOn && !minOffSatisfied) {
            relayOn = false;
        }
        if (!relayOn && !minOnSatisfied) {
            relayOn = true;
        }
    }

    const nextState: ControllerState = {
        ...state,
        relayOn,
        lastOnAt: relayOn ? (state.relayOn ? state.lastOnAt : nowMs) : state.lastOnAt,
        lastOffAt: relayOn ? state.lastOffAt : state.relayOn ? nowMs : state.lastOffAt,
    };

    return { relayOn, state: nextState };
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
