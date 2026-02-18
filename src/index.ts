import type { API } from 'homebridge';
import { PrometheusHeatingPlatform } from './platform.ts';

const PLATFORM_NAME = 'PrometheusHeatingPlatform';

export = (api: API): void => {
    api.registerPlatform(PLATFORM_NAME, PrometheusHeatingPlatform);
};
