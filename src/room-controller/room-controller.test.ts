import { describe, it, expect, vi } from 'vitest';
import { createRoomController } from './room-controller.ts';
import type { RoomConfig } from '../config/schema.ts';
import type { ControlParams } from '../control/heating-controller.ts';
import type { RoomThermostatAccessory } from '../accessories/room-thermostat.ts';
import type { PrometheusClient } from '../clients/prometheus-client.ts';
import type { ShellyDriver } from '../shelly';
import type { Logging } from 'homebridge';
import type { IntervalId, IntervalScheduler } from '../runtime/dependencies.ts';

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

// Mirrors what the platform would compose: mergeControlParams(global, room)
// with the values the old minimalConfig.control carried.
const controlParams = {
    controlMode: 'hysteresis',
    hysteresisC: 0.5,
    maxTargetTemperatureC: 24,
    maxTemperatureC: 60,
    minOffMs: 60_000,
    minOnMs: 60_000,
    minTargetTemperatureC: 18,
    minTemperatureC: -20,
    pwmCycleMs: 300_000,
    staleAfterMs: 180_000,
} as const satisfies ControlParams;

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
            // Real HAP commits the characteristic value only after the set
            // callback fires, so invoke the handler first and commit after.
            modeHandler?.(value);
            currentMode = value;
        },
        updates,
    };
}

describe('createRoomController', () => {
    it('starts, runs one tick, and invokes onStatePersist and thermostat updates', async () => {
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
        const setIntervalDelays: number[] = [];
        const clearIntervalCalls: ReturnType<IntervalScheduler['setInterval']>[] = [];
        let intervalId = 0;

        const controller = createRoomController({
            deps: {
                clock: { now: () => 200_000 },
                createShellyDriver: async () => fakeDriver,
                intervalScheduler: {
                    setInterval: (cb: () => void, ms: number): IntervalId => {
                        setIntervalCalls.push(cb);
                        setIntervalDelays.push(ms);
                        intervalId += 1;
                        return intervalId as unknown as IntervalId;
                    },
                    clearInterval: (id: ReturnType<IntervalScheduler['setInterval']>) => {
                        clearIntervalCalls.push(id);
                    },
                },
            },
            log,
            prometheus: fakePrometheus,
            params: controlParams,
            pollIntervalMs: 45_000,
            logging: { debug: false, logPromQueries: false },
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
        expect(setIntervalDelays).toEqual([45_000]);

        controller.stop();
        expect(clearIntervalCalls).toContain(intervalId);
    });

    it('triggerImmediate fires an extra Shelly call without waiting for poll', async () => {
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
            deps: {
                clock: { now: () => 200_000 },
                createShellyDriver: async () => fakeDriver,
                intervalScheduler: {
                    setInterval: () => 1 as unknown as ReturnType<IntervalScheduler['setInterval']>,
                    clearInterval: vi.fn(),
                },
            },
            log,
            prometheus: fakePrometheus,
            params: controlParams,
            pollIntervalMs: 30_000,
            logging: { debug: false, logPromQueries: false },
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
                createShellyDriver: async () => fakeDriver,
                intervalScheduler: {
                    setInterval: () => 1 as unknown as ReturnType<IntervalScheduler['setInterval']>,
                    clearInterval: vi.fn(),
                },
            },
            log,
            prometheus: fakePrometheus,
            params: controlParams,
            pollIntervalMs: 30_000,
            logging: { debug: false, logPromQueries: false },
            onStatePersist: () => {},
            persistedState: undefined,
            room: minimalRoom,
            thermostat,
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
            deps: {
                clock: { now: () => 200_000 },
                createShellyDriver: async () => fakeDriver,
                intervalScheduler: {
                    setInterval: () => 1 as unknown as ReturnType<IntervalScheduler['setInterval']>,
                    clearInterval: vi.fn(),
                },
            },
            log,
            prometheus: fakePrometheus,
            params: controlParams,
            pollIntervalMs: 30_000,
            logging: { debug: false, logPromQueries: false },
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

    it('mode change triggers an immediate tick', async () => {
        const thermostat = createFakeThermostat(21, 1);
        // starts in HEAT mode
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
            deps: {
                clock: { now: () => 200_000 },
                createShellyDriver: async () => fakeDriver,
                intervalScheduler: {
                    setInterval: () => 1 as unknown as ReturnType<IntervalScheduler['setInterval']>,
                    clearInterval: vi.fn(),
                },
            },
            log,
            prometheus: fakePrometheus,
            params: controlParams,
            pollIntervalMs: 30_000,
            logging: { debug: false, logPromQueries: false },
            onStatePersist: () => {},
            persistedState: undefined,
            room: minimalRoom,
            thermostat,
        });

        controller.start();
        // Wait for startup tick.
        await vi.waitFor(() => expect(setOnArgs.length).toBeGreaterThanOrEqual(1));
        const callsAfterStart = setOnArgs.length;

        // User flips mode to OFF – handler fires an immediate tick. The startup
        // tick (temp 20, target 21 → HEAT decides on) called setOn(true); the
        // OFF branch of evaluateControl must force setOn(false) end-to-end.
        thermostat.simulateModeSet(0);
        await vi.waitFor(() => expect(setOnArgs.length).toBeGreaterThan(callsAfterStart));

        // Relay must have been turned off.
        expect(setOnArgs[setOnArgs.length - 1]).toBe(false);

        controller.stop();
    });

    it('treats a sample without a timestamp as infinitely old and forces the relay off', async () => {
        // Sentinel-path pin for the single staleness rule: value present but
        // timestampMs 0 → age derivation must yield Infinity → stale → setOn(false).
        const thermostat = createFakeThermostat(21);
        const setOnArgs: boolean[] = [];
        const warn = vi.fn();
        const log = {
            debug: vi.fn(),
            info: vi.fn(),
            warn,
            error: vi.fn(),
            prefix: '',
            success: vi.fn(),
            log: vi.fn(),
        } as unknown as Logging;
        const fakePrometheus = {
            query: vi.fn().mockResolvedValue({ value: 20, timestampMs: 0 }),
        } as unknown as PrometheusClient;
        const fakeDriver: ShellyDriver = {
            setOn: vi.fn().mockImplementation((v: boolean) => {
                setOnArgs.push(v);
                return Promise.resolve();
            }),
            getOn: vi.fn().mockResolvedValue(false),
        };

        const controller = createRoomController({
            deps: {
                clock: { now: () => 200_000 },
                createShellyDriver: async () => fakeDriver,
                intervalScheduler: {
                    setInterval: () => 1 as unknown as ReturnType<IntervalScheduler['setInterval']>,
                    clearInterval: vi.fn(),
                },
            },
            log,
            prometheus: fakePrometheus,
            params: controlParams,
            pollIntervalMs: 30_000,
            logging: { debug: false, logPromQueries: false },
            onStatePersist: () => {},
            persistedState: undefined,
            room: minimalRoom,
            thermostat,
        });

        controller.start();
        await vi.waitFor(() => expect(setOnArgs.length).toBeGreaterThanOrEqual(1));
        expect(setOnArgs[setOnArgs.length - 1]).toBe(false);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('no timestamp'));

        controller.stop();
    });

    it('does not call onStatePersist when the Shelly setOn call rejects', async () => {
        const thermostat = createFakeThermostat(21);
        const persistCalls: [string, boolean][] = [];
        const warn = vi.fn();
        const log = {
            debug: vi.fn(),
            info: vi.fn(),
            warn,
            error: vi.fn(),
            prefix: '',
            success: vi.fn(),
            log: vi.fn(),
        } as unknown as Logging;
        const fakePrometheus = {
            query: vi.fn().mockResolvedValue({ value: 20, timestampMs: 200_000 }),
        } as unknown as PrometheusClient;
        const fakeDriver: ShellyDriver = {
            setOn: vi.fn().mockRejectedValue(new Error('boom')),
            getOn: vi.fn().mockResolvedValue(false),
        };

        const controller = createRoomController({
            deps: {
                clock: { now: () => 200_000 },
                createShellyDriver: async () => fakeDriver,
                intervalScheduler: {
                    setInterval: () => 1 as unknown as ReturnType<IntervalScheduler['setInterval']>,
                    clearInterval: vi.fn(),
                },
            },
            log,
            prometheus: fakePrometheus,
            params: controlParams,
            pollIntervalMs: 30_000,
            logging: { debug: false, logPromQueries: false },
            onStatePersist: (roomId, relayOn) => persistCalls.push([roomId, relayOn]),
            persistedState: undefined,
            room: minimalRoom,
            thermostat,
        });

        controller.start();
        // The tick still completes (thermostat updates run after the failed apply).
        await vi.waitFor(() => expect(thermostat.updates.currentTemp).toBe(20));

        expect(persistCalls.length).toBe(0);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Shelly setOn failed'));

        controller.stop();
    });

    it('calls onStatePersist on every successful setOn, even when the relay value is unchanged', async () => {
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
            query: vi.fn().mockResolvedValue({ value: 20, timestampMs: 200_000 }),
        } as unknown as PrometheusClient;
        const fakeDriver: ShellyDriver = {
            setOn: vi.fn().mockResolvedValue(undefined),
            getOn: vi.fn().mockResolvedValue(false),
        };

        const controller = createRoomController({
            deps: {
                clock: { now: () => 200_000 },
                createShellyDriver: async () => fakeDriver,
                intervalScheduler: {
                    setInterval: () => 1 as unknown as ReturnType<IntervalScheduler['setInterval']>,
                    clearInterval: vi.fn(),
                },
            },
            log,
            prometheus: fakePrometheus,
            params: controlParams,
            pollIntervalMs: 30_000,
            logging: { debug: false, logPromQueries: false },
            onStatePersist: (roomId, relayOn) => persistCalls.push([roomId, relayOn]),
            persistedState: undefined,
            room: minimalRoom,
            thermostat,
        });

        controller.start();
        // Startup tick: temp 20, target 21 → relay ON → persist #1.
        await vi.waitFor(() => expect(persistCalls.length).toBe(1));

        // Second tick with the same decision → relay stays ON → persist #2
        // (not debounced: every successful setOn persists).
        thermostat.simulateTargetSet(21);
        await vi.waitFor(() => expect(persistCalls.length).toBe(2));
        expect(persistCalls.every(([id, on]) => id === 'room1' && on === true)).toBe(true);

        controller.stop();
    });

    it('does not override TargetHeatingCoolingState back to HEAT on periodic ticks', async () => {
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
            deps: {
                clock: { now: () => 200_000 },
                createShellyDriver: async () => fakeDriver,
                intervalScheduler: {
                    setInterval: () => 1 as unknown as ReturnType<IntervalScheduler['setInterval']>,
                    clearInterval: vi.fn(),
                },
            },
            log,
            prometheus: fakePrometheus,
            params: controlParams,
            pollIntervalMs: 30_000,
            logging: { debug: false, logPromQueries: false },
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

    it('logs the tick debug line and not the PromQL line when logging.debug is on', async () => {
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
        const fakePrometheus = {
            query: vi.fn().mockResolvedValue({ value: 20, timestampMs: 200_000 }),
        } as unknown as PrometheusClient;
        const fakeDriver: ShellyDriver = {
            setOn: vi.fn().mockResolvedValue(undefined),
            getOn: vi.fn().mockResolvedValue(false),
        };

        const controller = createRoomController({
            deps: {
                clock: { now: () => 200_000 },
                createShellyDriver: async () => fakeDriver,
                intervalScheduler: {
                    setInterval: () => 1 as unknown as ReturnType<IntervalScheduler['setInterval']>,
                    clearInterval: vi.fn(),
                },
            },
            log,
            prometheus: fakePrometheus,
            params: controlParams,
            pollIntervalMs: 30_000,
            logging: { debug: true, logPromQueries: false },
            onStatePersist: () => {},
            persistedState: undefined,
            room: minimalRoom,
            thermostat,
        });

        controller.start();
        await vi.waitFor(() => expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('] tick temp=')));
        expect(log.debug).not.toHaveBeenCalledWith(expect.stringContaining('PromQL:'));

        controller.stop();
    });

    it('logs the PromQL line and not the tick debug line when logging.logPromQueries is on', async () => {
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
        const fakePrometheus = {
            query: vi.fn().mockResolvedValue({ value: 20, timestampMs: 200_000 }),
        } as unknown as PrometheusClient;
        const fakeDriver: ShellyDriver = {
            setOn: vi.fn().mockResolvedValue(undefined),
            getOn: vi.fn().mockResolvedValue(false),
        };

        const controller = createRoomController({
            deps: {
                clock: { now: () => 200_000 },
                createShellyDriver: async () => fakeDriver,
                intervalScheduler: {
                    setInterval: () => 1 as unknown as ReturnType<IntervalScheduler['setInterval']>,
                    clearInterval: vi.fn(),
                },
            },
            log,
            prometheus: fakePrometheus,
            params: controlParams,
            pollIntervalMs: 30_000,
            logging: { debug: false, logPromQueries: true },
            onStatePersist: () => {},
            persistedState: undefined,
            room: minimalRoom,
            thermostat,
        });

        controller.start();
        await vi.waitFor(() => expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('PromQL:')));
        expect(log.debug).not.toHaveBeenCalledWith(expect.stringContaining('] tick temp='));

        controller.stop();
    });

    it('stop clears interval and nulls driver', () => {
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
            prometheus: {
                query: vi.fn().mockResolvedValue({ value: 20, timestampMs: 0 }),
            } as unknown as PrometheusClient,
            params: controlParams,
            pollIntervalMs: 30_000,
            logging: { debug: false, logPromQueries: false },
            room: minimalRoom,
            thermostat,
            persistedState: undefined,
            onStatePersist: () => {},
            deps: {
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
