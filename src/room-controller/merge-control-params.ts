import type { ControlConfig, RoomConfig } from '../config/schema.ts';
import type { ControlParams } from '../control/heating-controller.ts';

export function mergeControlParams(global: ControlConfig, room: RoomConfig) {
    const o = room.override;
    return {
        controlMode: global.controlMode,
        hysteresisC: o?.deadbandC ?? global.hysteresisC,
        maxTemperatureC: global.maxTemperatureC,
        minOffMs: o?.minOffMs ?? global.minOffMs,
        minOnMs: o?.minOnMs ?? global.minOnMs,
        minTemperatureC: global.minTemperatureC,
        pwmCycleMs: o?.pwmCycleMs ?? global.pwmCycleMs,
        staleAfterMs: global.staleAfterMs,
        targetTemperatureC: room.targetTemperatureC,
    } as const satisfies ControlParams;
}
