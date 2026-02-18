import type { ShellyDriver } from './shelly-driver.ts';
import type { AbortControllerFactory, HttpClient, TimeoutScheduler } from '../runtime/dependencies.ts';
import { defaultAbortControllerFactory, defaultHttpClient, defaultTimeoutScheduler } from '../runtime/dependencies.ts';

const LEGACY_STATUS_PATH = '/status';

interface Gen1StatusRelay {
    ison: boolean;
}

interface Gen1Status {
    relays?: Gen1StatusRelay[];
}

export interface Gen1DriverDeps {
    httpClient: HttpClient;
    timeoutScheduler: TimeoutScheduler;
    abortControllerFactory: AbortControllerFactory;
}

export function createGen1Driver(options: {
    host: string;
    switchId: number;
    requestTimeoutMs: number;
    username?: string;
    password?: string;
    deps?: Partial<Gen1DriverDeps>;
}): ShellyDriver {
    const baseUrl = `http://${options.host.replace(/^https?:\/\//, '')}`;
    const switchId = options.switchId;
    const timeoutMs = options.requestTimeoutMs;
    const auth =
        options.username && options.password
            ? `Basic ${Buffer.from(`${options.username}:${options.password}`).toString('base64')}`
            : undefined;

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (auth) {
        headers['Authorization'] = auth;
    }

    const httpClient = options.deps?.httpClient ?? defaultHttpClient;
    const timeoutScheduler = options.deps?.timeoutScheduler ?? defaultTimeoutScheduler;
    const abortControllerFactory = options.deps?.abortControllerFactory ?? defaultAbortControllerFactory;

    async function fetchUrl(path: string): Promise<unknown> {
        const controller = abortControllerFactory.create();
        const t = timeoutScheduler.setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await httpClient.fetch(`${baseUrl}${path}`, {
                headers,
                signal: controller.signal,
            });
            timeoutScheduler.clearTimeout(t);
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            return (await res.json()) as unknown;
        } catch (e) {
            timeoutScheduler.clearTimeout(t);
            throw e;
        }
    }

    return {
        async setOn(on: boolean): Promise<void> {
            const path = `/relay/${switchId}?turn=${on ? 'on' : 'off'}`;
            await fetchUrl(path);
        },
        async getOn(): Promise<boolean> {
            const body = (await fetchUrl(LEGACY_STATUS_PATH)) as Gen1Status;
            const relays = body.relays;
            if (!Array.isArray(relays) || relays[switchId] === undefined) {
                return false;
            }
            return Boolean(relays[switchId]?.ison);
        },
    };
}
