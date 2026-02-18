import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
import { APIEvent } from 'homebridge';
import { pluginConfigSchema, type PluginConfig } from './config/schema.ts';
import { createRoomThermostat } from './accessories/room-thermostat.ts';
import { createRoomController } from './room-controller/index.ts';
import {
    loadPersistedState,
    savePersistedState,
    updateRoomState,
    type PersistedState,
} from './state/persisted-state.ts';

const PLUGIN_NAME = 'homebridge-prometheus-heating';
const PLATFORM_NAME = 'PrometheusHeatingPlatform';

let hap: API['hap'];
let PlatformAccessoryClass: typeof PlatformAccessory;

export class PrometheusHeatingPlatform implements DynamicPlatformPlugin {
    private readonly log: Logging;
    private readonly api: API;
    private readonly config: PluginConfig | null;
    private readonly accessories: PlatformAccessory[] = [];
    private readonly roomControllers: ReturnType<typeof createRoomController>[] = [];
    private persistedState: PersistedState = { rooms: {} };

    constructor(log: Logging, config: PlatformConfig, api: API) {
        this.log = log;
        this.api = api;

        const parseResult = pluginConfigSchema.safeParse(config);
        if (!parseResult.success) {
            log.error('Invalid config: ' + parseResult.error.message);
            this.config = null;
            return;
        }
        this.config = parseResult.data;

        log.info(`Platform "${this.config.name}" initializing with ${this.config.rooms.length} room(s).`);

        api.on(APIEvent.DID_FINISH_LAUNCHING, () => this.didFinishLaunching());
    }

    configureAccessory(accessory: PlatformAccessory): void {
        this.log.info('Configuring cached accessory: %s', accessory.displayName);
        accessory.on('identify', () => this.log.info('%s identified', accessory.displayName));
        this.accessories.push(accessory);
    }

    private async didFinishLaunching(): Promise<void> {
        if (!this.config) {
            return;
        }
        hap = this.api.hap;
        PlatformAccessoryClass = this.api.platformAccessory;

        const persistDir = this.api.user.persistPath();
        this.persistedState = await loadPersistedState(persistDir);

        const configuredIds = new Set(this.config.rooms.filter((r) => r.enabled).map((r) => r.id));
        const cachedByRoomId = new Map<string, PlatformAccessory>();
        for (const acc of this.accessories) {
            const roomId = acc.context?.roomId as string | undefined;
            if (roomId) {
                cachedByRoomId.set(roomId, acc);
            }
        }

        for (const acc of this.accessories) {
            const roomId = acc.context?.roomId as string | undefined;
            if (roomId && !configuredIds.has(roomId)) {
                this.log.info('Removing orphaned accessory: %s', acc.displayName);
                this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [acc]);
            }
        }

        const toRegister: PlatformAccessory[] = [];

        for (const room of this.config.rooms) {
            if (!room.enabled) {
                continue;
            }

            let accessory = cachedByRoomId.get(room.id);
            let thermostat: ReturnType<typeof createRoomThermostat>;

            if (accessory) {
                const svc = accessory.getService(hap.Service.Thermostat);
                if (!svc) {
                    continue;
                }
                thermostat = {
                    accessory,
                    updateCurrentTemperature: (v) =>
                        svc.getCharacteristic(hap.Characteristic.CurrentTemperature).updateValue(v),
                    updateTargetTemperature: (v) =>
                        svc.getCharacteristic(hap.Characteristic.TargetTemperature).updateValue(v),
                    updateCurrentHeatingCoolingState: (v) =>
                        svc.getCharacteristic(hap.Characteristic.CurrentHeatingCoolingState).updateValue(v),
                    updateTargetHeatingCoolingState: (v) =>
                        svc.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState).updateValue(v),
                    getTargetTemperature: () =>
                        (svc.getCharacteristic(hap.Characteristic.TargetTemperature).value as number) ??
                        room.targetTemperatureC,
                    getTargetHeatingCoolingState: () =>
                        (svc.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState).value as number) ?? 1,
                    setTargetTemperatureHandler: (handler) => {
                        svc.getCharacteristic(hap.Characteristic.TargetTemperature).on(
                            'set',
                            (value: unknown, cb: () => void) => {
                                const v = typeof value === 'number' ? value : Number(value);
                                if (Number.isFinite(v)) {
                                    handler(v);
                                }
                                cb();
                            },
                        );
                    },
                    setTargetHeatingCoolingStateHandler: (handler) => {
                        svc.getCharacteristic(hap.Characteristic.TargetHeatingCoolingState).on(
                            'set',
                            (value: unknown, cb: () => void) => {
                                const v = typeof value === 'number' ? value : Number(value);
                                if (Number.isFinite(v)) {
                                    handler(v);
                                }
                                cb();
                            },
                        );
                    },
                };
            } else {
                thermostat = createRoomThermostat(
                    hap,
                    PlatformAccessoryClass,
                    this.log,
                    room.displayName,
                    room.id,
                    room.targetTemperatureC,
                    room.minTargetTemperatureC,
                    room.maxTargetTemperatureC,
                );
                accessory = thermostat.accessory;
                accessory.context.roomId = room.id;
                toRegister.push(accessory);
            }

            const controller = createRoomController({
                log: this.log,
                config: this.config,
                room,
                thermostat,
                persistedState: this.persistedState.rooms[room.id],
                onStatePersist: (rid, relayOn) => this.persistRoomState(rid, relayOn, persistDir),
            });
            this.roomControllers.push(controller);
            controller.start();
        }

        if (toRegister.length > 0) {
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, toRegister);
            toRegister.forEach((a) => this.accessories.push(a));
        }
    }

    private async persistRoomState(roomId: string, relayOn: boolean, persistDir: string): Promise<void> {
        this.persistedState = updateRoomState(this.persistedState, roomId, relayOn);
        await savePersistedState(persistDir, this.persistedState).catch((e) =>
            this.log.warn('Failed to persist state: %s', String(e)),
        );
    }
}
