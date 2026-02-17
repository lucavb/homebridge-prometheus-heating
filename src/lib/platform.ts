import { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
import { HomebridgeHeatingConfig, validateConfig } from '../interfaces/config';
import { HeatingAccessory } from './accessory';

export const PLUGIN_IDENTIFIED = 'homebridge-deconz-shelly-thermostat';
export const PLATFORM_NAME = 'DeconzShellyThermostat';

export class HomebridgeHeatingPlatform implements DynamicPlatformPlugin {
    private readonly accessories: PlatformAccessory[] = [];
    private readonly accessoryHandlers = new Map<string, HeatingAccessory>();

    private readonly validatedConfig?: HomebridgeHeatingConfig;

    constructor(
        private readonly logger: Logging,
        private readonly config: PlatformConfig,
        private readonly api: API,
    ) {
        this.logger.info('Finished initializing platform:', this.config.name);

        try {
            this.validatedConfig = validateConfig(this.config);
        } catch (error) {
            this.logger.error('Invalid configuration:', error instanceof Error ? error.message : String(error));
            return;
        }

        this.api.on('didFinishLaunching', () => {
            logger.debug('Executed didFinishLaunching callback');
            this.discoverDevices();
        });
    }

    configureAccessory(accessory: PlatformAccessory): void {
        this.logger.info('Loading accessory from cache:', accessory.displayName);
        this.accessories.push(accessory);
    }

    discoverDevices(): void {
        if (!this.validatedConfig) {
            this.logger.error('Cannot discover devices: configuration is invalid');
            return;
        }

        const configuredUUIDs = new Set<string>();

        for (const accessoryConfig of this.validatedConfig.accessories) {
            const uuid = this.api.hap.uuid.generate(accessoryConfig.name);
            configuredUUIDs.add(uuid);

            const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

            const oldHandler = this.accessoryHandlers.get(uuid);
            if (oldHandler) {
                this.logger.debug('Destroying old handler for:', accessoryConfig.name);
                oldHandler.destroy();
            }

            if (existingAccessory) {
                this.logger.info('Restoring existing accessory from cache:', existingAccessory.displayName);
                const handler = new HeatingAccessory(this.logger, accessoryConfig, existingAccessory, this.api);
                this.accessoryHandlers.set(uuid, handler);
            } else {
                this.logger.info('Adding new accessory:', accessoryConfig.name);
                const accessory = new this.api.platformAccessory(accessoryConfig.name, uuid);
                accessory.category = this.api.hap.Categories.THERMOSTAT;
                const handler = new HeatingAccessory(this.logger, accessoryConfig, accessory, this.api);
                this.accessoryHandlers.set(uuid, handler);
                this.api.registerPlatformAccessories(PLUGIN_IDENTIFIED, PLATFORM_NAME, [accessory]);
                this.accessories.push(accessory);
            }
        }

        const staleAccessories = this.accessories.filter((accessory) => !configuredUUIDs.has(accessory.UUID));
        if (staleAccessories.length > 0) {
            this.logger.info('Removing', staleAccessories.length, 'stale accessories');
            for (const accessory of staleAccessories) {
                const handler = this.accessoryHandlers.get(accessory.UUID);
                if (handler) {
                    handler.destroy();
                    this.accessoryHandlers.delete(accessory.UUID);
                }
            }
            this.api.unregisterPlatformAccessories(PLUGIN_IDENTIFIED, PLATFORM_NAME, staleAccessories);
            for (const accessory of staleAccessories) {
                const index = this.accessories.indexOf(accessory);
                if (index > -1) {
                    this.accessories.splice(index, 1);
                }
            }
        }
    }
}
