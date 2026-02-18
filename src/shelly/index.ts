import type { ShellyDriver, ShellyGeneration } from './shelly-driver.ts';
import { createGen1Driver } from './gen1-driver.ts';
import { createGen23RpcDriver } from './gen23-rpc-driver.ts';
import type { ShellyConfig } from '../config/schema.ts';
import type { AbortControllerFactory, HttpClient, TimeoutScheduler } from '../runtime/dependencies.ts';
import { defaultAbortControllerFactory, defaultHttpClient, defaultTimeoutScheduler } from '../runtime/dependencies.ts';

const RPC_DEVICE_INFO = '/rpc/Shelly.GetDeviceInfo';

export interface ShellyProbeDeps {
    httpClient: HttpClient;
    timeoutScheduler: TimeoutScheduler;
    abortControllerFactory: AbortControllerFactory;
}

async function probeGeneration(host: string, timeoutMs: number, deps: ShellyProbeDeps): Promise<ShellyGeneration> {
    const baseUrl = `http://${host.replace(/^https?:\/\//, '')}`;
    const controller = deps.abortControllerFactory.create();
    const t = deps.timeoutScheduler.setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await deps.httpClient.fetch(`${baseUrl}${RPC_DEVICE_INFO}`, {
            signal: controller.signal,
        });
        deps.timeoutScheduler.clearTimeout(t);
        if (res.ok) {
            return 'gen23';
        }
    } catch {
        deps.timeoutScheduler.clearTimeout(t);
    }
    return 'gen1';
}

const defaultShellyProbeDeps: ShellyProbeDeps = {
    httpClient: defaultHttpClient,
    timeoutScheduler: defaultTimeoutScheduler,
    abortControllerFactory: defaultAbortControllerFactory,
};

export function createShellyDriver(config: ShellyConfig, deps?: Partial<ShellyProbeDeps>): ShellyDriver {
    const gen = config.generation === 'auto' ? undefined : config.generation;
    const opts = {
        host: config.host,
        switchId: config.switchId,
        requestTimeoutMs: config.requestTimeoutMs,
        ...(config.username !== undefined && { username: config.username }),
        ...(config.password !== undefined && { password: config.password }),
        ...(deps !== undefined && { deps }),
    };
    if (gen === 'gen1') {
        return createGen1Driver(opts);
    }
    if (gen === 'gen23') {
        return createGen23RpcDriver(opts);
    }
    return createGen23RpcDriver(opts);
}

export async function createShellyDriverWithProbe(
    config: ShellyConfig,
    deps?: Partial<ShellyProbeDeps>,
): Promise<ShellyDriver> {
    if (config.generation !== 'auto') {
        return createShellyDriver(config, deps);
    }
    const probeDeps = deps ? { ...defaultShellyProbeDeps, ...deps } : defaultShellyProbeDeps;
    const gen = await probeGeneration(config.host, config.requestTimeoutMs, probeDeps);
    return createShellyDriver({ ...config, generation: gen }, deps);
}

export { createGen1Driver, createGen23RpcDriver };
export type { ShellyDriver, ShellyGeneration } from './shelly-driver.ts';
