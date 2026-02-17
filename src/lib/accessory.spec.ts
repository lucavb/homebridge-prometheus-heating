import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HeatingAccessory } from './accessory';
import { API, Logging, PlatformAccessory } from 'homebridge';
import { AccessoryConfig } from '../interfaces/config';

describe('HeatingAccessory', () => {
    let mockLogger: Logging;
    let mockApi: Partial<API>;
    let mockAccessory: Partial<PlatformAccessory>;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as unknown as Logging;

        const mockService = {
            getCharacteristic: vi.fn().mockReturnValue({
                onGet: vi.fn().mockReturnThis(),
                onSet: vi.fn().mockReturnThis(),
                setValue: vi.fn().mockReturnThis(),
            }),
        };

        mockAccessory = {
            UUID: 'test-uuid',
            displayName: 'Test Thermostat',
            getService: vi.fn().mockReturnValue(mockService),
            addService: vi.fn().mockReturnValue(mockService),
        };

        mockApi = {
            hap: {
                Service: {
                    Thermostat: 'Thermostat',
                } as unknown,
                Characteristic: {
                    CurrentHeatingCoolingState: {
                        HEAT: 1,
                        OFF: 0,
                    } as unknown,
                    TargetHeatingCoolingState: {
                        OFF: 0,
                        HEAT: 1,
                        COOL: 2,
                    } as unknown,
                    CurrentTemperature: 'CurrentTemperature',
                    TargetTemperature: 'TargetTemperature',
                } as unknown,
                Categories: {
                    THERMOSTAT: 9,
                } as unknown,
            } as unknown,
            on: vi.fn(),
        };
    });

    it('should create a HeatingAccessory instance', () => {
        const config: AccessoryConfig = {
            name: 'Test Thermostat',
            deconz: {
                host: 'localhost',
                id: 1,
                user: 'testuser',
            },
            shelly: {
                host: 'localhost',
                relay: 0,
            },
            temperatureWindow: 0.5,
            pollingInterval: 120000,
        };

        const accessory = new HeatingAccessory(mockLogger, config, mockAccessory as PlatformAccessory, mockApi as API);

        expect(accessory).toBeInstanceOf(HeatingAccessory);
    });

    it('should handle missing deconz/shelly config gracefully', () => {
        const config = {
            name: 'Test Thermostat',
            temperatureWindow: 0.5,
            pollingInterval: 120000,
        } as AccessoryConfig;

        const accessory = new HeatingAccessory(mockLogger, config, mockAccessory as PlatformAccessory, mockApi as API);

        expect(accessory).toBeInstanceOf(HeatingAccessory);
        expect(mockLogger.error).toHaveBeenCalledWith('need both deconz and shelly key');
    });

    it('should cleanup properly when destroyed', () => {
        const config: AccessoryConfig = {
            name: 'Test Thermostat',
            deconz: {
                host: 'localhost',
                id: 1,
                user: 'testuser',
            },
            shelly: {
                host: 'localhost',
                relay: 0,
            },
            temperatureWindow: 0.5,
            pollingInterval: 120000,
        };

        const accessory = new HeatingAccessory(mockLogger, config, mockAccessory as PlatformAccessory, mockApi as API);

        accessory.destroy();
        accessory.destroy();

        expect(mockLogger.debug).toHaveBeenCalledWith('Destroying accessory:', 'Test Thermostat');
    });
});
