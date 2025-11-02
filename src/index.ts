import { API } from 'homebridge';
import { HomebridgeHeatingPlatform, PLATFORM_NAME, PLUGIN_IDENTIFIED } from './lib/platform';

export = (homebridge: API): void => {
    homebridge.registerPlatform(PLUGIN_IDENTIFIED, PLATFORM_NAME, HomebridgeHeatingPlatform);
};
