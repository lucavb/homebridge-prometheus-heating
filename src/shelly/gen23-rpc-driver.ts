import type { ShellyDriver } from './shelly-driver.ts';
import type { AbortControllerFactory, HttpClient, TimeoutScheduler } from '../runtime/dependencies.ts';
import { defaultAbortControllerFactory, defaultHttpClient, defaultTimeoutScheduler } from '../runtime/dependencies.ts';

const RPC_PATH = '/rpc';

interface RpcRequest {
    id: number;
    method: string;
    params?: Record<string, unknown> | undefined;
}

interface SwitchGetStatusResult {
    id: number;
    output: boolean;
}

export interface Gen23DriverDeps {
    httpClient: HttpClient;
    timeoutScheduler: TimeoutScheduler;
    abortControllerFactory: AbortControllerFactory;
}

export function createGen23RpcDriver(options: {
    host: string;
    switchId: number;
    requestTimeoutMs: number;
    username?: string;
    password?: string;
    deps?: Partial<Gen23DriverDeps>;
}): ShellyDriver {
    const baseUrl = `http://${options.host.replace(/^https?:\/\//, '')}`;
    const switchId = options.switchId;
    const timeoutMs = options.requestTimeoutMs;
    const auth =
        options.username && options.password
            ? `Basic ${Buffer.from(`${options.username}:${options.password}`).toString('base64')}`
            : undefined;

    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (auth) {
        headers['Authorization'] = auth;
    }

    const httpClient = options.deps?.httpClient ?? defaultHttpClient;
    const timeoutScheduler = options.deps?.timeoutScheduler ?? defaultTimeoutScheduler;
    const abortControllerFactory = options.deps?.abortControllerFactory ?? defaultAbortControllerFactory;

    async function rpc(method: string, params?: Record<string, unknown>): Promise<unknown> {
        const controller = abortControllerFactory.create();
        const t = timeoutScheduler.setTimeout(() => controller.abort(), timeoutMs);
        try {
            const body: RpcRequest = { id: 1, method, params: params ?? {} };
            const res = await httpClient.fetch(`${baseUrl}${RPC_PATH}`, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            timeoutScheduler.clearTimeout(t);
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const data = (await res.json()) as { result?: unknown };
            return data.result;
        } catch (e) {
            timeoutScheduler.clearTimeout(t);
            throw e;
        }
    }

    return {
        async setOn(on: boolean): Promise<void> {
            await rpc('Switch.Set', { id: switchId, on });
        },
        async getOn(): Promise<boolean> {
            const result = (await rpc('Switch.GetStatus', { id: switchId })) as SwitchGetStatusResult | undefined;
            if (result) {
                return result.output;
            }
            return false;
        },
    };
}
