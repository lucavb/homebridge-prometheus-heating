import { describe, it, expect } from 'vitest';
import { mergeControlParams } from './merge-control-params.ts';
import type { ControlConfig, RoomConfig } from './schema.ts';

// Distinctive globals so a misrouted or dropped override field breaks toEqual.
const globalConfig: ControlConfig = {
    controlMode: 'pwm',
    pollIntervalMs: 30_000,
    hysteresisC: 1,
    minOnMs: 111_000,
    minOffMs: 222_000,
    pwmCycleMs: 333_000,
    staleAfterMs: 444_000,
    minTemperatureC: -30,
    maxTemperatureC: 70,
};

function room(override?: RoomConfig['override']): RoomConfig {
    return {
        displayName: 'Room',
        enabled: true,
        id: 'room1',
        maxTargetTemperatureC: 24,
        minTargetTemperatureC: 16,
        override,
        promQuery: 'room_temp',
        shelly: {
            generation: 'gen1',
            host: '192.168.1.1',
            switchId: 0,
            requestTimeoutMs: 5000,
        },
        targetTemperatureC: 21,
    };
}

describe('mergeControlParams', () => {
    it('passes globals through and rooms min/max target temperature through when no override', () => {
        expect(mergeControlParams(globalConfig, room())).toEqual({
            controlMode: 'pwm',
            hysteresisC: 1,
            maxTargetTemperatureC: 24,
            maxTemperatureC: 70,
            minOffMs: 222_000,
            minOnMs: 111_000,
            minTargetTemperatureC: 16,
            minTemperatureC: -30,
            pwmCycleMs: 333_000,
            staleAfterMs: 444_000,
        });
    });

    it('maps override deadbandC onto hysteresisC, beating the global', () => {
        expect(mergeControlParams(globalConfig, room({ deadbandC: 0.25 }))).toEqual({
            controlMode: 'pwm',
            hysteresisC: 0.25,
            maxTargetTemperatureC: 24,
            maxTemperatureC: 70,
            minOffMs: 222_000,
            minOnMs: 111_000,
            minTargetTemperatureC: 16,
            minTemperatureC: -30,
            pwmCycleMs: 333_000,
            staleAfterMs: 444_000,
        });
    });

    it('override minOnMs wins over the global', () => {
        const params = mergeControlParams(globalConfig, room({ minOnMs: 55_000 }));
        expect(params.minOnMs).toBe(55_000);
    });

    it('override minOffMs wins over the global', () => {
        const params = mergeControlParams(globalConfig, room({ minOffMs: 66_000 }));
        expect(params.minOffMs).toBe(66_000);
    });

    it('override pwmCycleMs wins over the global', () => {
        const params = mergeControlParams(globalConfig, room({ pwmCycleMs: 77_000 }));
        expect(params.pwmCycleMs).toBe(77_000);
    });

    it('overrides apply per key; unset keys keep the global', () => {
        expect(mergeControlParams(globalConfig, room({ deadbandC: 0.25, minOnMs: 55_000 }))).toEqual({
            controlMode: 'pwm',
            hysteresisC: 0.25,
            maxTargetTemperatureC: 24,
            maxTemperatureC: 70,
            minOffMs: 222_000,
            minOnMs: 55_000,
            minTargetTemperatureC: 16,
            minTemperatureC: -30,
            pwmCycleMs: 333_000,
            staleAfterMs: 444_000,
        });
    });
});
