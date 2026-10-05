import type { ControlParams } from '../control/heating-controller.ts';
import type { ControlConfig, RoomConfig } from './schema.ts';

export function mergeControlParams(global: ControlConfig, room: RoomConfig) {
    const o = room.override;
    return {
        controlMode: global.controlMode,
        hysteresisC: o?.deadbandC ?? global.hysteresisC,
        maxTargetTemperatureC: room.maxTargetTemperatureC,
        maxTemperatureC: global.maxTemperatureC,
        minOffMs: o?.minOffMs ?? global.minOffMs,
        minOnMs: o?.minOnMs ?? global.minOnMs,
        minTargetTemperatureC: room.minTargetTemperatureC,
        minTemperatureC: global.minTemperatureC,
        pwmCycleMs: o?.pwmCycleMs ?? global.pwmCycleMs,
        staleAfterMs: global.staleAfterMs,
    } as const satisfies ControlParams;
}
