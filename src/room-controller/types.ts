import type { Logging } from 'homebridge';
import type { PluginConfig, RoomConfig, ShellyConfig } from '../config/schema.ts';
import type { PrometheusClientOptions } from '../clients/prometheus-client.ts';
import { PrometheusClient } from '../clients/prometheus-client.ts';
import { createShellyDriverWithProbe } from '../shelly/index.ts';
import type { ShellyDriver } from '../shelly/shelly-driver.ts';
import type { RoomThermostatAccessory } from '../accessories/room-thermostat.ts';
import type { RoomPersistedState } from '../state/persisted-state.ts';
import type { Clock, IntervalScheduler } from '../runtime/dependencies.ts';
import { defaultClock, defaultIntervalScheduler } from '../runtime/dependencies.ts';

export const HEAT = 1;
export const OFF = 0;

export interface RoomControllerDeps {
    createPrometheusClient: (opts: PrometheusClientOptions) => PrometheusClient;
    createShellyDriver: (config: ShellyConfig) => Promise<ShellyDriver>;
    clock: Clock;
    intervalScheduler: IntervalScheduler;
}

export interface RoomControllerOptions {
    log: Logging;
    config: PluginConfig;
    room: RoomConfig;
    thermostat: RoomThermostatAccessory;
    persistedState: RoomPersistedState | undefined;
    onStatePersist: (roomId: string, relayOn: boolean) => void;
    deps?: Partial<RoomControllerDeps>;
}

export const defaultRoomControllerDeps = {
    clock: defaultClock,
    createPrometheusClient: (opts) => new PrometheusClient(opts),
    createShellyDriver: (config) => createShellyDriverWithProbe(config),
    intervalScheduler: defaultIntervalScheduler,
} as const satisfies RoomControllerDeps;
