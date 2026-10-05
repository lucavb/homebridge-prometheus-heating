import type { HAP, Logging, PlatformAccessory, Service } from 'homebridge';
import { describe, it, expect, vi } from 'vitest';
import { attachRoomThermostat, createRoomThermostat, HEAT, OFF } from './room-thermostat.ts';
import type { PlatformAccessoryConstructor } from './room-thermostat.ts';

// Single cast point: production code is typed against homebridge's HAP/Service/
// Characteristic; the plain-object fakes below are narrowed here once, so all
// fake call sites stay unchanged if the production signatures change.
function asFake<T>(fake: unknown): T {
    return fake as T;
}

const CurrentTemperature = { UUID: 'current-temperature' };
const TargetTemperature = { UUID: 'target-temperature' };
const CurrentHeatingCoolingState = { UUID: 'current-heating-cooling-state' };
const TargetHeatingCoolingState = { UUID: 'target-heating-cooling-state' };
const TemperatureDisplayUnits = { UUID: 'temperature-display-units', CELSIUS: 0 };
const ThermostatService = { UUID: 'thermostat-service' };
const THERMOSTAT_CATEGORY = 9;

interface FakeCharacteristic {
    value: number | undefined;
    setValueCalls: number[];
    propsCalls: unknown[];
    updateValues: number[];
    setListeners: Array<(value: unknown, callback: () => void) => void>;
    setValue(value: number): FakeCharacteristic;
    setProps(props: unknown): FakeCharacteristic;
    updateValue(value: number): void;
    on(event: 'set', listener: (value: unknown, callback: () => void) => void): void;
}

function createFakeCharacteristic(): FakeCharacteristic {
    const fake: FakeCharacteristic = {
        value: undefined,
        setValueCalls: [],
        propsCalls: [],
        updateValues: [],
        setListeners: [],
        setValue(value) {
            fake.value = value;
            fake.setValueCalls.push(value);
            return fake;
        },
        setProps(props) {
            fake.propsCalls.push(props);
            return fake;
        },
        updateValue(value) {
            fake.value = value;
            fake.updateValues.push(value);
        },
        on(event, listener) {
            // The production module only ever wires 'set'; registering on any
            // other event must fail loudly so a wrong-event mutant cannot pass.
            if (event !== 'set') {
                throw new Error('unwired characteristic event');
            }
            fake.setListeners.push(listener);
        },
    };
    return fake;
}

interface FakeService {
    characteristics: Map<unknown, FakeCharacteristic>;
    getCharacteristic(characteristic: unknown): FakeCharacteristic;
}

function createFakeService(): FakeService {
    const characteristics = new Map<unknown, FakeCharacteristic>();
    return {
        characteristics,
        getCharacteristic(characteristic: unknown): FakeCharacteristic {
            let char = characteristics.get(characteristic);
            if (!char) {
                char = createFakeCharacteristic();
                characteristics.set(characteristic, char);
            }
            return char;
        },
    };
}

function createHarness() {
    const service = createFakeService();
    const createdAccessories: Array<{ displayName: string; uuid: string; category: unknown }> = [];
    const addedServices: unknown[] = [];

    class FakePlatformAccessory {
        constructor(displayName: string, uuid: string, category: unknown) {
            createdAccessories.push({ displayName, uuid, category });
        }
        addService(svc: unknown): FakeService {
            addedServices.push(svc);
            return service;
        }
    }

    const fakeHap = {
        uuid: { generate: (seed: string) => `generated-${seed}` },
        Categories: { THERMOSTAT: THERMOSTAT_CATEGORY },
        Characteristic: {
            CurrentTemperature,
            TargetTemperature,
            CurrentHeatingCoolingState,
            TargetHeatingCoolingState,
            TemperatureDisplayUnits,
        },
        Service: { Thermostat: ThermostatService },
    };

    return {
        service,
        hap: asFake<HAP>(fakeHap),
        log: asFake<Logging>({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
        platformAccessoryClass: asFake<PlatformAccessoryConstructor>(FakePlatformAccessory),
        createdAccessories,
        addedServices,
        char(selected: unknown): FakeCharacteristic {
            const char = service.characteristics.get(selected);
            if (!char) {
                throw new Error('characteristic not wired');
            }
            return char;
        },
        setListener(selected: unknown): (value: unknown, callback: () => void) => void {
            // accessing the harness object's own method via `this` keeps the helpers together
            const char = this.char(selected);
            const listener = char.setListeners[0];
            if (!listener) {
                throw new Error('no set listener registered');
            }
            return listener;
        },
    };
}

describe('room-thermostat', () => {
    it('createRoomThermostat initialises a new accessory with the initial values', () => {
        const h = createHarness();
        const t = createRoomThermostat(h.hap, h.platformAccessoryClass, h.log, 'Living Room', 'room1', 21, 18, 24);

        expect(h.createdAccessories).toEqual([
            { displayName: 'Living Room', uuid: 'generated-prometheus-heating-room1', category: THERMOSTAT_CATEGORY },
        ]);
        expect(h.addedServices).toEqual([ThermostatService]);

        expect(h.char(CurrentTemperature).value).toBe(21);
        expect(h.char(TargetTemperature).value).toBe(21);
        expect(h.char(CurrentHeatingCoolingState).value).toBe(OFF);
        expect(h.char(TargetHeatingCoolingState).value).toBe(HEAT);
        expect(h.char(TemperatureDisplayUnits).value).toBe(TemperatureDisplayUnits.CELSIUS);

        // The create path applies initial values (unlike the attach path).
        expect(h.char(TargetTemperature).setValueCalls).toEqual([21]);
        expect(h.char(TargetHeatingCoolingState).setValueCalls).toEqual([HEAT]);

        // Exactly one set listener per characteristic, mirroring the attach path.
        expect(h.char(TargetTemperature).setListeners).toHaveLength(1);
        expect(h.char(TargetHeatingCoolingState).setListeners).toHaveLength(1);

        expect('updateTargetHeatingCoolingState' in t).toBe(false);
    });

    it('createRoomThermostat applies characteristic props (bounds, step, validValues)', () => {
        const h = createHarness();
        const t = createRoomThermostat(h.hap, h.platformAccessoryClass, h.log, 'Living Room', 'room1', 21, 18, 24);

        expect(t.getTargetTemperature()).toBe(21);
        expect(h.char(CurrentTemperature).propsCalls).toEqual([{ minValue: -20, maxValue: 60 }]);
        expect(h.char(TargetTemperature).propsCalls).toEqual([{ minValue: 18, maxValue: 24, minStep: 0.1 }]);
        expect(h.char(TargetHeatingCoolingState).propsCalls).toEqual([
            { minValue: OFF, maxValue: HEAT, validValues: [OFF, HEAT] },
        ]);
        expect(h.char(TemperatureDisplayUnits).propsCalls).toEqual([]);
    });

    it('attachRoomThermostat re-applies setProps without overriding persisted values', () => {
        const h = createHarness();
        const accessory = asFake<PlatformAccessory>({ displayName: 'Cached', context: { roomId: 'room1' } });

        // Simulate HAP-persisted user state on the cached accessory's existing service.
        h.service.getCharacteristic(TargetTemperature).value = 22.5;
        h.service.getCharacteristic(TargetHeatingCoolingState).value = OFF;

        // The characteristics carry arbitrary pre-seeded props; the pin is that
        // attach's setProps win over whatever is on the service. Wire it once
        // first to prove the re-application after a previous attach, too.
        const stale = attachRoomThermostat(h.hap, accessory, asFake<Service>(h.service), {
            initialTargetC: 16,
            minTargetC: 10,
            maxTargetC: 30,
        });
        expect(stale.accessory).toBe(accessory);
        expect(stale.getTargetTemperature()).toBe(22.5);
        expect(stale.getTargetHeatingCoolingState()).toBe(OFF);

        const t = attachRoomThermostat(h.hap, accessory, asFake<Service>(h.service), {
            initialTargetC: 21,
            minTargetC: 18,
            maxTargetC: 24,
        });

        expect(h.char(TargetTemperature).propsCalls).toEqual([
            { minValue: 10, maxValue: 30, minStep: 0.1 },
            { minValue: 18, maxValue: 24, minStep: 0.1 },
        ]);
        expect(h.char(TargetHeatingCoolingState).propsCalls).toEqual([
            { minValue: OFF, maxValue: HEAT, validValues: [OFF, HEAT] },
            { minValue: OFF, maxValue: HEAT, validValues: [OFF, HEAT] },
        ]);
        expect(h.char(CurrentTemperature).propsCalls).toEqual([
            { minValue: -20, maxValue: 60 },
            { minValue: -20, maxValue: 60 },
        ]);
        expect(h.char(TemperatureDisplayUnits).propsCalls).toEqual([]);

        // Persisted values survive: attach must never apply initial values.
        expect(h.char(TargetTemperature).value).toBe(22.5);
        expect(h.char(TargetHeatingCoolingState).value).toBe(OFF);
        expect(h.char(TemperatureDisplayUnits).value).toBeUndefined();
        expect(h.char(TargetTemperature).setValueCalls).toEqual([]);
        expect(h.char(TargetHeatingCoolingState).setValueCalls).toEqual([]);
        expect(h.char(CurrentTemperature).setValueCalls).toEqual([]);
        expect(h.char(CurrentHeatingCoolingState).setValueCalls).toEqual([]);
        expect(t.getTargetTemperature()).toBe(22.5);
        expect(t.getTargetHeatingCoolingState()).toBe(OFF);

        t.updateCurrentTemperature(20);
        expect(h.char(CurrentTemperature).updateValues).toEqual([20]);
    });

    it('attachRoomThermostat registers one set listener per characteristic', () => {
        const h = createHarness();
        const accessory = asFake<PlatformAccessory>({ displayName: 'Cached', context: { roomId: 'room1' } });

        attachRoomThermostat(h.hap, accessory, asFake<Service>(h.service), {
            initialTargetC: 21,
            minTargetC: 18,
            maxTargetC: 24,
        });

        expect(h.char(TargetTemperature).setListeners).toHaveLength(1);
        expect(h.char(TargetHeatingCoolingState).setListeners).toHaveLength(1);
    });

    it('set events are coerced: numeric passes through, values not coercing to a finite number are ignored, callback always runs', () => {
        const h = createHarness();
        const t = createRoomThermostat(h.hap, h.platformAccessoryClass, h.log, 'Living Room', 'room1', 21, 18, 24);

        const handler = vi.fn();
        const callback = vi.fn();
        t.setTargetTemperatureHandler(handler);
        const listener = h.setListener(TargetTemperature);

        listener(22, callback);
        expect(handler).toHaveBeenCalledWith(22);
        expect(callback).toHaveBeenCalledTimes(1);

        handler.mockClear();
        callback.mockClear();
        listener('not-a-number', callback);
        expect(handler).not.toHaveBeenCalled();
        expect(callback).toHaveBeenCalledTimes(1);

        handler.mockClear();
        callback.mockClear();
        listener('23.5', callback);
        expect(handler).toHaveBeenCalledWith(23.5);
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('mode set events reach the registered handler (0 is finite and passes through)', () => {
        const h = createHarness();
        const t = createRoomThermostat(h.hap, h.platformAccessoryClass, h.log, 'Living Room', 'room1', 21, 18, 24);

        const handler = vi.fn();
        const callback = vi.fn();
        t.setTargetHeatingCoolingStateHandler(handler);
        const listener = h.setListener(TargetHeatingCoolingState);

        listener(OFF, callback);
        expect(handler).toHaveBeenCalledWith(OFF);
        expect(callback).toHaveBeenCalledTimes(1);

        handler.mockClear();
        callback.mockClear();
        listener('garbage', callback);
        expect(handler).not.toHaveBeenCalled();
        expect(callback).toHaveBeenCalledTimes(1);

        handler.mockClear();
        callback.mockClear();
        listener('1', callback);
        expect(handler).toHaveBeenCalledWith(HEAT);
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('getters return the characteristic value, falling back when undefined', () => {
        const h = createHarness();
        const t = createRoomThermostat(h.hap, h.platformAccessoryClass, h.log, 'Living Room', 'room1', 21, 18, 24);

        expect(t.getTargetTemperature()).toBe(21);
        expect(t.getTargetHeatingCoolingState()).toBe(HEAT);

        h.char(TargetTemperature).value = undefined;
        expect(t.getTargetTemperature()).toBe(21); // fallback ?? initialTargetC
        h.char(TargetTemperature).value = 22.5;
        expect(t.getTargetTemperature()).toBe(22.5);

        h.char(TargetHeatingCoolingState).value = undefined;
        expect(t.getTargetHeatingCoolingState()).toBe(HEAT); // fallback ?? HEAT
        h.char(TargetHeatingCoolingState).value = OFF;
        expect(t.getTargetHeatingCoolingState()).toBe(OFF); // 0 must not fall back
    });

    it('attachRoomThermostat getters use the passed initialTargetC and HEAT as fallbacks', () => {
        const h = createHarness();
        const accessory = asFake<PlatformAccessory>({ displayName: 'Cached', context: { roomId: 'room1' } });
        const t = attachRoomThermostat(h.hap, accessory, asFake<Service>(h.service), {
            initialTargetC: 19.5,
            minTargetC: 18,
            maxTargetC: 24,
        });

        // attach must not setValue even when the characteristic is fresh/undefined,
        // otherwise the fallback would never be reachable.
        expect(h.char(TargetTemperature).setValueCalls).toEqual([]);
        expect(h.char(TargetHeatingCoolingState).setValueCalls).toEqual([]);

        expect(t.getTargetTemperature()).toBe(19.5);
        h.char(TargetTemperature).value = 22.5;
        expect(t.getTargetTemperature()).toBe(22.5);

        h.char(TargetHeatingCoolingState).value = undefined;
        expect(t.getTargetHeatingCoolingState()).toBe(HEAT);
    });

    it('update methods call updateValue on the right characteristic', () => {
        const h = createHarness();
        const t = createRoomThermostat(h.hap, h.platformAccessoryClass, h.log, 'Living Room', 'room1', 21, 18, 24);

        t.updateCurrentTemperature(20.25);
        t.updateTargetTemperature(21.5);
        t.updateCurrentHeatingCoolingState(HEAT);

        expect(h.char(CurrentTemperature).updateValues).toEqual([20.25]);
        expect(h.char(TargetTemperature).updateValues).toEqual([21.5]);
        expect(h.char(CurrentHeatingCoolingState).updateValues).toEqual([HEAT]);
        expect(h.char(TargetHeatingCoolingState).updateValues).toEqual([]);
    });
});
