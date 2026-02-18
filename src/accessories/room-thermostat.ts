import type { HAP, Logging, PlatformAccessory } from 'homebridge';

const HEAT = 1;
const OFF = 0;

type PlatformAccessoryConstructor = typeof PlatformAccessory;

export interface RoomThermostatAccessory {
    accessory: PlatformAccessory;
    getTargetTemperature(): number;
    getTargetHeatingCoolingState(): number;
    setTargetTemperatureHandler(handler: (value: number) => void): void;
    setTargetHeatingCoolingStateHandler(handler: (value: number) => void): void;
    updateCurrentHeatingCoolingState(state: number): void;
    updateCurrentTemperature(value: number): void;
    updateTargetHeatingCoolingState(state: number): void;
    updateTargetTemperature(value: number): void;
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

    service
        .getCharacteristic(hap.Characteristic.CurrentTemperature)
        .setValue(initialTargetC)
        .setProps({ minValue: -20, maxValue: 60 });

    service
        .getCharacteristic(hap.Characteristic.TargetTemperature)
        .setValue(initialTargetC)
        .setProps({ minValue: minTargetC, maxValue: maxTargetC, minStep: 0.1 });

    service.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState).setValue(OFF);
    service
        .getCharacteristic(hap.Characteristic.TargetHeatingCoolingState)
        .setValue(HEAT)
        .setProps({
            minValue: OFF,
            maxValue: HEAT,
            validValues: [OFF, HEAT],
        });

    service
        .getCharacteristic(hap.Characteristic.TemperatureDisplayUnits)
        .setValue(hap.Characteristic.TemperatureDisplayUnits.CELSIUS);

    let targetHandler: ((value: number) => void) | undefined;
    let modeHandler: ((value: number) => void) | undefined;

    service
        .getCharacteristic(hap.Characteristic.TargetTemperature)
        .on('set', (value: unknown, callback: () => void) => {
            const v = typeof value === 'number' ? value : Number(value);
            if (Number.isFinite(v)) {
                targetHandler?.(v);
            }
            callback();
        });

    service
        .getCharacteristic(hap.Characteristic.TargetHeatingCoolingState)
        .on('set', (value: unknown, callback: () => void) => {
            const v = typeof value === 'number' ? value : Number(value);
            if (Number.isFinite(v)) {
                modeHandler?.(v);
            }
            callback();
        });

    return {
        accessory,
        updateCurrentTemperature(value: number) {
            service.getCharacteristic(hap.Characteristic.CurrentTemperature).updateValue(value);
        },
        updateTargetTemperature(value: number) {
            service.getCharacteristic(hap.Characteristic.TargetTemperature).updateValue(value);
        },
        updateCurrentHeatingCoolingState(state: number) {
            service.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState).updateValue(state);
        },
        updateTargetHeatingCoolingState(state: number) {
            service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState).updateValue(state);
        },
        getTargetTemperature() {
            return (service.getCharacteristic(hap.Characteristic.TargetTemperature).value as number) ?? initialTargetC;
        },
        getTargetHeatingCoolingState() {
            return (service.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState).value as number) ?? HEAT;
        },
        setTargetTemperatureHandler(handler: (value: number) => void) {
            targetHandler = handler;
        },
        setTargetHeatingCoolingStateHandler(handler: (value: number) => void) {
            modeHandler = handler;
        },
    };
}
