import { describe, it, expect, vi } from 'vitest';
import { createRoomController } from './room-controller.ts';
import type { PluginConfig, RoomConfig } from '../config/schema.ts';
import type { RoomThermostatAccessory } from '../accessories/room-thermostat.ts';
import type { PrometheusClient } from '../clients/prometheus-client.ts';
import type { ShellyDriver } from '../shelly';
import type { Logging } from 'homebridge';
import type { IntervalId, IntervalScheduler } from '../runtime/dependencies.ts';

const minimalConfig = {
    name: 'Test',
    prometheus: {
        allowInsecureTls: false,
        auth: { mode: 'none' },
        baseUrl: 'http://prom:9090',
        queryTimeoutMs: 5000,
    },
    control: {
        controlMode: 'hysteresis',
        hysteresisC: 0.5,
        maxTemperatureC: 60,
        minOffMs: 60_000,
        minOnMs: 60_000,
        minTemperatureC: -20,
        pollIntervalMs: 30_000,
        pwmCycleMs: 300_000,
        staleAfterMs: 180_000,
        targetTemperatureC: 21,
    },
    rooms: [],
    logging: { debug: false, logPromQueries: false },
} as const satisfies PluginConfig;

const minimalRoom = {
    id: 'room1',
    displayName: 'Room 1',
    promQuery: 'room_temp',
    targetTemperatureC: 21,
    minTargetTemperatureC: 18,
    maxTargetTemperatureC: 24,
    shelly: {
        host: '192.168.1.1',
        generation: 'gen1',
        switchId: 0,
        requestTimeoutMs: 5000,
    },
    enabled: true,
} as const satisfies RoomConfig;

function createFakeThermostat(
    initialTarget: number,
    initialMode = 1,
): RoomThermostatAccessory & {
    updates: { currentTemp?: number; targetTemp?: number; currentState?: number; targetState?: number };
    simulateTargetSet(value: number): void;
    simulateModeSet(value: number): void;
} {
    const updates: {
        currentState?: number;
        currentTemp?: number;
        targetState?: number;
        targetTemp?: number;
    } = {};
    let currentMode = initialMode;
    let tempHandler: ((value: number) => void) | undefined;
    let modeHandler: ((value: number) => void) | undefined;
    return {
        accessory: {} as RoomThermostatAccessory['accessory'],
        updateCurrentTemperature: (v: number) => {
            updates.currentTemp = v;
        },
        updateTargetTemperature: (v: number) => {
            updates.targetTemp = v;
        },
        updateCurrentHeatingCoolingState: (v: number) => {
            updates.currentState = v;
        },
        updateTargetHeatingCoolingState: (v: number) => {
            updates.targetState = v;
        },
        getTargetTemperature: () => initialTarget,
        getTargetHeatingCoolingState: () => currentMode,
        setTargetTemperatureHandler: (handler) => {
            tempHandler = handler;
        },
        setTargetHeatingCoolingStateHandler: (handler) => {
            modeHandler = handler;
        },
        simulateTargetSet(value: number) {
            tempHandler?.(value);
        },
        simulateModeSet(value: number) {
            currentMode = value; // simulates HAP committing the value after callback
            modeHandler?.(value);
        },
        updates,
    };
}

describe('createRoomController', () => {
    it('starts, runs one tick, and invokes onStatePersist and thermostat updates', async () => {
        const config = { ...minimalConfig, rooms: [minimalRoom] };
        const thermostat = createFakeThermostat(21);
        const persistCalls: [string, boolean][] = [];
        const log = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            prefix: '',
            success: vi.fn(),
            log: vi.fn(),
        } as unknown as Logging;

        const fakePrometheus = {
            query: vi.fn().mockResolvedValue({ value: 20, timestampMs: 1000 }),
        } as unknown as PrometheusClient;

        const fakeDriver: ShellyDriver = {
            setOn: vi.fn().mockResolvedValue(undefined),
            getOn: vi.fn().mockResolvedValue(false),
        };

        const setIntervalCalls: Array<() => void> = [];
        const clearIntervalCalls: ReturnType<IntervalScheduler['setInterval']>[] = [];
        let intervalId = 0;

        const controller = createRoomController({
            config,
            deps: {
                clock: { now: () => 200_000 },
                createPrometheusClient: () => fakePrometheus,
                createShellyDriver: async () => fakeDriver,
                intervalScheduler: {
                    setInterval: (cb: () => void): IntervalId => {
                        setIntervalCalls.push(cb);
                        intervalId += 1;
                        return intervalId as unknown as IntervalId;
                    },
                    clearInterval: (id: ReturnType<IntervalScheduler['setInterval']>) => {
                        clearIntervalCalls.push(id);
                    },
                },
            },
            log,
            onStatePersist: (roomId, relayOn) => persistCalls.push([roomId, relayOn]),
            persistedState: undefined,
            room: minimalRoom,
            thermostat,
        });

        controller.start();
        await vi.waitFor(() => {
            expect(persistCalls.length).toBeGreaterThanOrEqual(1);
        });

        expect(persistCalls.some(([id]) => id === 'room1')).toBe(true);
        expect(thermostat.updates.currentTemp).toBe(20);
        expect(thermostat.updates.targetTemp).toBe(21);
        expect(setIntervalCalls.length).toBe(1);

        controller.stop();
        expect(clearIntervalCalls).toContain(intervalId);
    });

    it('triggerImmediate fires an extra Shelly call without waiting for poll', async () => {
        const config = { ...minimalConfig, rooms: [minimalRoom] };
        const thermostat = createFakeThermostat(21);
        const log = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            prefix: '',
            success: vi.fn(),
            log: vi.fn(),
        } as unknown as Logging;
        const setOnCalls: boolean[] = [];
        const fakePrometheus = {
            query: vi.fn().mockResolvedValue({ value: 20, timestampMs: 200_000 }),
        } as unknown as PrometheusClient;
        const fakeDriver: ShellyDriver = {
            setOn: vi.fn().mockImplementation((v: boolean) => {
                setOnCalls.push(v);
                return Promise.resolve();
            }),
            getOn: vi.fn().mockResolvedValue(false),
        };

        const controller = createRoomController({
            config,
            deps: {
                clock: { now: () => 200_000 },
                createPrometheusClient: () => fakePrometheus,
                createShellyDriver: async () => fakeDriver,
                intervalScheduler: {
                    setInterval: () => 1 as unknown as ReturnType<IntervalScheduler['setInterval']>,
                    clearInterval: vi.fn(),
                },
            },
            log,
            onStatePersist: () => {},
            persistedState: undefined,
            room: minimalRoom,
            thermostat,
        });

        controller.start();
        // Wait for the startup tick.
        await vi.waitFor(() => expect(setOnCalls.length).toBeGreaterThanOrEqual(1));
        const callsAfterStart = setOnCalls.length;

        // User changes target temperature – handler fires triggerImmediate.
        thermostat.simulateTargetSet(22);
        await vi.waitFor(() => expect(setOnCalls.length).toBeGreaterThan(callsAfterStart));

        controller.stop();
    });

    it('uses the value passed to the handler, not the characteristic, for the immediate tick target', async () => {
        // Simulates the HAP race: characteristic.value has NOT been committed yet
        // when the set-event fires. The handler receives the new value as a parameter
        // and must use it directly rather than reading from getTargetTemperature().
        const config = { ...minimalConfig, rooms: [minimalRoom] };

        // getTargetTemperature() always returns the OLD value (21) to simulate
        // the characteristic not yet being committed by HAP.
        const thermostat = createFakeThermostat(21);

        const capturedTargets: number[] = [];
        const fakePrometheus = {
            // Capture the target that tick() computed from the passed value.
            // We infer it via the relay decision: temp=20, if target=22 → relay ON, if target=21 → relay ON too.
            // So instead, probe via updateTargetTemperature which is called at end of tick.
            query: vi.fn().mockResolvedValue({ value: 20, timestampMs: 200_000 }),
        } as unknown as PrometheusClient;
        const originalUpdateTargetTemperature = thermostat.updateTargetTemperature.bind(thermostat);
        thermostat.updateTargetTemperature = (v: number) => {
            capturedTargets.push(v);
            originalUpdateTargetTemperature(v);
        };
        const fakeDriver: ShellyDriver = {
            setOn: vi.fn().mockResolvedValue(undefined),
            getOn: vi.fn().mockResolvedValue(false),
        };
        const log = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            prefix: '',
            success: vi.fn(),
            log: vi.fn(),
        } as unknown as Logging;

        const controller = createRoomController({
            deps: {
                clock: { now: () => 200_000 },
                createPrometheusClient: () => fakePrometheus,
                createShellyDriver: async () => fakeDriver,
                intervalScheduler: {
                    setInterval: () => 1 as unknown as ReturnType<IntervalScheduler['setInterval']>,
                    clearInterval: vi.fn(),
                },
            },
            log,
            onStatePersist: () => {},
            persistedState: undefined,
            room: minimalRoom,
            thermostat,
            config,
        });

        controller.start();
        // Wait for startup tick (target=21 from getTargetTemperature).
        await vi.waitFor(() => expect(capturedTargets.length).toBeGreaterThanOrEqual(1));
        capturedTargets.length = 0;

        // Simulate user setting 22°C. Note: getTargetTemperature() still returns 21
        // because the fake thermostat hasn't been "committed" to 22 yet.
        thermostat.simulateTargetSet(22);
        await vi.waitFor(() => expect(capturedTargets.length).toBeGreaterThanOrEqual(1));

        // The immediate tick must have used the handler-supplied value (22), not 21.
        expect(capturedTargets[0]).toBe(22);

        controller.stop();
    });

    it('concurrent triggerImmediate while tick is in progress is coalesced to one extra run', async () => {
        const config = { ...minimalConfig, rooms: [minimalRoom] };
        const thermostat = createFakeThermostat(21);
        const log = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            prefix: '',
            success: vi.fn(),
            log: vi.fn(),
        } as unknown as Logging;

        let resolveQuery!: () => void;
        let queryCallCount = 0;
        const fakePrometheus = {
            query: vi.fn().mockImplementation(
                () =>
                    new Promise<{ value: number; timestampMs: number }>((resolve) => {
                        queryCallCount += 1;
                        resolveQuery = () => resolve({ value: 20, timestampMs: 200_000 });
                    }),
            ),
        } as unknown as PrometheusClient;
        const fakeDriver: ShellyDriver = {
            setOn: vi.fn().mockResolvedValue(undefined),
            getOn: vi.fn().mockResolvedValue(false),
        };

        const controller = createRoomController({
            config,
            deps: {
                clock: { now: () => 200_000 },
                createPrometheusClient: () => fakePrometheus,
                createShellyDriver: async () => fakeDriver,
                intervalScheduler: {
                    setInterval: () => 1 as unknown as ReturnType<IntervalScheduler['setInterval']>,
                    clearInterval: vi.fn(),
                },
            },
            log,
            onStatePersist: () => {},
            persistedState: undefined,
            room: minimalRoom,
            thermostat,
        });

        controller.start();
        // Wait until the first query is in-flight.
        await vi.waitFor(() => expect(queryCallCount).toBe(1));

        // Fire two immediate triggers while the first tick is blocked.
        thermostat.simulateTargetSet(22);
        thermostat.simulateTargetSet(23);

        // Unblock first query – controller drains the pending immediate with one more query.
        resolveQuery();
        await vi.waitFor(() => expect(queryCallCount).toBe(2));

        // No third query should be triggered (the two immediates were coalesced).
        await new Promise((r) => setTimeout(r, 20));
        expect(queryCallCount).toBe(2);

        controller.stop();
    });

    it('turning mode OFF triggers an immediate tick and forces relay off', async () => {
        // Room is cold (20°C) and target is 21°C so normal control would turn relay ON.
        // When the user flips mode to OFF, the relay must be forced off immediately.
        const config = { ...minimalConfig, rooms: [minimalRoom] };
        const thermostat = createFakeThermostat(21, 1); // starts in HEAT mode
        const setOnArgs: boolean[] = [];
        const fakePrometheus = {
            query: vi.fn().mockResolvedValue({ value: 20, timestampMs: 200_000 }),
        } as unknown as PrometheusClient;
        const fakeDriver: ShellyDriver = {
            setOn: vi.fn().mockImplementation((v: boolean) => {
                setOnArgs.push(v);
                return Promise.resolve();
            }),
            getOn: vi.fn().mockResolvedValue(false),
        };
        const log = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            prefix: '',
            success: vi.fn(),
            log: vi.fn(),
        } as unknown as Logging;

        const controller = createRoomController({
            config: {
                ...config,
                control: { ...config.control, minOnMs: 0, minOffMs: 0 },
            },
            deps: {
                clock: { now: () => 200_000 },
                createPrometheusClient: () => fakePrometheus,
                createShellyDriver: async () => fakeDriver,
                intervalScheduler: {
                    setInterval: () => 1 as unknown as ReturnType<IntervalScheduler['setInterval']>,
                    clearInterval: vi.fn(),
                },
            },
            log,
            onStatePersist: () => {},
            persistedState: undefined,
            room: minimalRoom,
            thermostat,
        });

        controller.start();
        // Wait for startup tick.
        await vi.waitFor(() => expect(setOnArgs.length).toBeGreaterThanOrEqual(1));
        setOnArgs.length = 0;

        // User flips mode to OFF.
        thermostat.simulateModeSet(0);
        await vi.waitFor(() => expect(setOnArgs.length).toBeGreaterThanOrEqual(1));

        // Relay must have been turned off.
        expect(setOnArgs[setOnArgs.length - 1]).toBe(false);

        controller.stop();
    });

    it('does not override TargetHeatingCoolingState back to HEAT on periodic ticks', async () => {
        const config = { ...minimalConfig, rooms: [minimalRoom] };
        const thermostat = createFakeThermostat(21, 1);
        const fakePrometheus = {
            query: vi.fn().mockResolvedValue({ value: 20, timestampMs: 200_000 }),
        } as unknown as PrometheusClient;
        const fakeDriver: ShellyDriver = {
            setOn: vi.fn().mockResolvedValue(undefined),
            getOn: vi.fn().mockResolvedValue(false),
        };
        const log = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            prefix: '',
            success: vi.fn(),
            log: vi.fn(),
        } as unknown as Logging;

        const controller = createRoomController({
            config,
            deps: {
                clock: { now: () => 200_000 },
                createPrometheusClient: () => fakePrometheus,
                createShellyDriver: async () => fakeDriver,
                intervalScheduler: {
                    setInterval: () => 1 as unknown as ReturnType<IntervalScheduler['setInterval']>,
                    clearInterval: vi.fn(),
                },
            },
            log,
            onStatePersist: () => {},
            persistedState: undefined,
            room: minimalRoom,
            thermostat,
        });

        controller.start();
        await vi.waitFor(() => expect(fakePrometheus.query).toHaveBeenCalled());
        await vi.waitFor(() => expect(thermostat.updates.currentState !== undefined).toBe(true));

        // TargetHeatingCoolingState must never be written by the control loop.
        expect(thermostat.updates.targetState).toBeUndefined();

        controller.stop();
    });

    it('stop clears interval and nulls driver', () => {
        const config = { ...minimalConfig, rooms: [minimalRoom] };
        const thermostat = createFakeThermostat(21);
        const log = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            prefix: '',
            success: vi.fn(),
            log: vi.fn(),
        } as unknown as Logging;
        let driverCreated = false;
        const controller = createRoomController({
            log,
            config,
            room: minimalRoom,
            thermostat,
            persistedState: undefined,
            onStatePersist: () => {},
            deps: {
                createPrometheusClient: () =>
                    ({
                        query: vi.fn().mockResolvedValue({ value: 20, timestampMs: 0 }),
                    }) as unknown as PrometheusClient,
                createShellyDriver: async () => {
                    driverCreated = true;
                    return {
                        setOn: vi.fn().mockResolvedValue(undefined),
                        getOn: vi.fn().mockResolvedValue(false),
                    };
                },
                clock: { now: () => 0 },
                intervalScheduler: {
                    setInterval: () => 1 as unknown as ReturnType<IntervalScheduler['setInterval']>,
                    clearInterval: vi.fn(),
                },
            },
        });
        controller.start();
        return vi
            .waitFor(() => expect(driverCreated).toBe(true))
            .then(() => {
                controller.stop();
            });
    });
});
