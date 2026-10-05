import type { Logging } from 'homebridge';
import type { RoomConfig, ShellyConfig } from '../config/schema.ts';
import type { PrometheusClient } from '../clients/prometheus-client.ts';
import type { ControlParams } from '../control/heating-controller.ts';
import { createShellyDriverWithProbe } from '../shelly/index.ts';
import type { ShellyDriver } from '../shelly/shelly-driver.ts';
import type { RoomThermostatAccessory } from '../accessories/room-thermostat.ts';
import type { RoomPersistedState } from '../state/persisted-state.ts';
import type { Clock, IntervalScheduler } from '../runtime/dependencies.ts';
import { defaultClock, defaultIntervalScheduler } from '../runtime/dependencies.ts';

export const HEAT = 1;
export const OFF = 0;

export interface RoomControllerDeps {
    createShellyDriver: (config: ShellyConfig) => Promise<ShellyDriver>;
    clock: Clock;
    intervalScheduler: IntervalScheduler;
}

export interface RoomControllerOptions {
    log: Logging;
    prometheus: PrometheusClient;
    params: ControlParams;
    pollIntervalMs: number;
    logging: { debug: boolean; logPromQueries: boolean };
    room: RoomConfig;
    thermostat: RoomThermostatAccessory;
    persistedState: RoomPersistedState | undefined;
    onStatePersist: (roomId: string, relayOn: boolean) => void;
    deps?: Partial<RoomControllerDeps>;
}

export const defaultRoomControllerDeps = {
    clock: defaultClock,
    createShellyDriver: (config) => createShellyDriverWithProbe(config),
    intervalScheduler: defaultIntervalScheduler,
} as const satisfies RoomControllerDeps;
