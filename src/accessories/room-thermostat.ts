import type { HAP, Logging, PlatformAccessory, Service } from 'homebridge';

// HAP characteristic values for the Thermostat service. Homed in this module — the
// Thermostat adapter owns them — and re-exported by room-controller/types.ts.
export const HEAT = 1;
export const OFF = 0;

export type PlatformAccessoryConstructor = typeof PlatformAccessory;

export interface ThermostatWiringOptions {
    initialTargetC: number;
    minTargetC: number;
    maxTargetC: number;
}

export interface RoomThermostatAccessory {
    accessory: PlatformAccessory;
    getTargetTemperature(): number;
    getTargetHeatingCoolingState(): number;
    setTargetTemperatureHandler(handler: (value: number) => void): void;
    setTargetHeatingCoolingStateHandler(handler: (value: number) => void): void;
    updateCurrentHeatingCoolingState(state: number): void;
    updateCurrentTemperature(value: number): void;
    updateTargetTemperature(value: number): void;
}

// Coerces a characteristic set-value to a finite number; null when the value
// would not be finite (NaN/Infinity/garbage strings).
function toFiniteNumber(value: unknown): number | null {
    const v = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(v) ? v : null;
}

// `applyInitialValues` is true for the new-accessory path and false for the
// attach path: a cached accessory's characteristic values are HAP-persisted
// user state and must survive restarts (setProps IS always re-applied).
function wireThermostatService(
    hap: HAP,
    accessory: PlatformAccessory,
    service: Service,
    opts: ThermostatWiringOptions,
    applyInitialValues: boolean,
): RoomThermostatAccessory {
    const { initialTargetC, minTargetC, maxTargetC } = opts;

    const currentTemperature = service.getCharacteristic(hap.Characteristic.CurrentTemperature);
    const targetTemperature = service.getCharacteristic(hap.Characteristic.TargetTemperature);
    const currentHeatingCoolingState = service.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState);
    const targetHeatingCoolingState = service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState);
    // All five characteristics are the same shared wiring on BOTH paths — the
    // fetch here also creates them on a new service; only the setValue and
    // setProps blocks below actually write.
    const temperatureDisplayUnits = service.getCharacteristic(hap.Characteristic.TemperatureDisplayUnits);

    if (applyInitialValues) {
        currentTemperature.setValue(initialTargetC);
        targetTemperature.setValue(initialTargetC);
        currentHeatingCoolingState.setValue(OFF);
        targetHeatingCoolingState.setValue(HEAT);
        temperatureDisplayUnits.setValue(hap.Characteristic.TemperatureDisplayUnits.CELSIUS);
    }

    currentTemperature.setProps({ minValue: -20, maxValue: 60 });
    targetTemperature.setProps({ minValue: minTargetC, maxValue: maxTargetC, minStep: 0.1 });
    targetHeatingCoolingState.setProps({
        minValue: OFF,
        maxValue: HEAT,
        validValues: [OFF, HEAT],
    });

    let targetHandler: ((value: number) => void) | undefined;
    let modeHandler: ((value: number) => void) | undefined;

    targetTemperature.on('set', (value: unknown, callback: () => void) => {
        const v = toFiniteNumber(value);
        if (v !== null) {
            targetHandler?.(v);
        }
        callback();
    });

    targetHeatingCoolingState.on('set', (value: unknown, callback: () => void) => {
        const v = toFiniteNumber(value);
        if (v !== null) {
            modeHandler?.(v);
        }
        callback();
    });

    return {
        accessory,
        updateCurrentTemperature(value: number) {
            currentTemperature.updateValue(value);
        },
        updateTargetTemperature(value: number) {
            targetTemperature.updateValue(value);
        },
        updateCurrentHeatingCoolingState(state: number) {
            currentHeatingCoolingState.updateValue(state);
        },
        getTargetTemperature() {
            return (targetTemperature.value as number) ?? initialTargetC;
        },
        getTargetHeatingCoolingState() {
            return (targetHeatingCoolingState.value as number) ?? HEAT;
        },
        setTargetTemperatureHandler(handler: (value: number) => void) {
            targetHandler = handler;
        },
        setTargetHeatingCoolingStateHandler(handler: (value: number) => void) {
            modeHandler = handler;
        },
    };
}

export function createRoomThermostat(
    hap: HAP,
    PlatformAccessoryClass: PlatformAccessoryConstructor,
    _log: Logging,
    displayName: string,
    roomId: string,
    initialTargetC: number,
    minTargetC: number,
    maxTargetC: number,
): RoomThermostatAccessory {
    const uuid = hap.uuid.generate(`prometheus-heating-${roomId}`);
    const accessory = new PlatformAccessoryClass(displayName, uuid, hap.Categories.THERMOSTAT);

    const service = accessory.addService(hap.Service.Thermostat, displayName);

    return wireThermostatService(hap, accessory, service, { initialTargetC, minTargetC, maxTargetC }, true);
}

export function attachRoomThermostat(
    hap: HAP,
    accessory: PlatformAccessory,
    service: Service,
    opts: ThermostatWiringOptions,
): RoomThermostatAccessory {
    return wireThermostatService(hap, accessory, service, opts, false);
}
