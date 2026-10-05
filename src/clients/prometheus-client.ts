import type { AbortControllerFactory, HttpClient, TimeoutScheduler } from '../runtime/dependencies.ts';
import { defaultAbortControllerFactory, defaultHttpClient, defaultTimeoutScheduler } from '../runtime/dependencies.ts';
import { Agent } from 'undici';

const PROMETHEUS_QUERY_PATH = '/api/v1/query';

export interface PrometheusQueryResult {
    value: number;
    timestampMs: number;
}

export interface PrometheusClientDeps {
    httpClient: HttpClient;
    timeoutScheduler: TimeoutScheduler;
    abortControllerFactory: AbortControllerFactory;
    createAgent?: (options: { connect: { rejectUnauthorized: boolean } }) => Agent;
}

export interface PrometheusClientOptions {
    baseUrl: string;
    queryTimeoutMs: number;
    auth?: { mode: 'none' } | { mode: 'bearer'; bearerToken: string };
    allowInsecureTls?: boolean;
    deps?: Partial<PrometheusClientDeps>;
}

function parseQueryResponse(body: unknown): PrometheusQueryResult | null {
    if (body === null || typeof body !== 'object') {
        return null;
    }
    const o = body as Record<string, unknown>;
    if (o.data === null || typeof o.data !== 'object') {
        return null;
    }
    const data = o.data as Record<string, unknown>;
    const resultType = data.resultType as string | undefined;
    const result = data.result;

    if (resultType === 'vector' && Array.isArray(result) && result.length > 0) {
        const first = result[0] as Record<string, unknown>;
        const valueArr = first.value;
        if (!Array.isArray(valueArr) || valueArr.length < 2) {
            return null;
        }
        const ts = Number(valueArr[0]);
        const val = Number(valueArr[1]);
        if (Number.isNaN(val) || !Number.isFinite(val) || Number.isNaN(ts) || !Number.isFinite(ts)) {
            return null;
        }
        return { value: val, timestampMs: ts * 1000 };
    }

    if (resultType === 'scalar' && Array.isArray(result) && result.length >= 2) {
        const ts = Number(result[0]);
        const val = Number(result[1]);
        if (Number.isNaN(val) || !Number.isFinite(val) || Number.isNaN(ts) || !Number.isFinite(ts)) {
            return null;
        }
        return { value: val, timestampMs: ts * 1000 };
    }

    return null;
}

export class PrometheusClient {
    private readonly abortControllerFactory: AbortControllerFactory;
    private readonly auth: PrometheusClientOptions['auth'];
    private readonly baseUrl: string;
    private readonly dispatcher: Agent | undefined;
    private readonly httpClient: HttpClient;
    private readonly queryTimeoutMs: number;
    private readonly timeoutScheduler: TimeoutScheduler;

    constructor(options: PrometheusClientOptions) {
        this.baseUrl = options.baseUrl.replace(/\/$/, '');
        this.queryTimeoutMs = options.queryTimeoutMs;
        this.auth = options.auth ?? { mode: 'none' };
        const deps = options.deps ?? {};
        const createAgent = deps.createAgent ?? ((o) => new Agent(o));
        this.dispatcher =
            options.allowInsecureTls === true ? createAgent({ connect: { rejectUnauthorized: false } }) : undefined;
        this.httpClient = deps.httpClient ?? defaultHttpClient;
        this.timeoutScheduler = deps.timeoutScheduler ?? defaultTimeoutScheduler;
        this.abortControllerFactory = deps.abortControllerFactory ?? defaultAbortControllerFactory;
    }

    async query(query: string): Promise<PrometheusQueryResult | null> {
        const url = new URL(PROMETHEUS_QUERY_PATH, this.baseUrl);
        url.searchParams.set('query', query);

        const headers: Record<string, string> = { Accept: 'application/json' };
        if (this.auth?.mode === 'bearer' && this.auth.bearerToken) {
            headers['Authorization'] = `Bearer ${this.auth.bearerToken}`;
        }

        const controller = this.abortControllerFactory.create();
        const timeoutId = this.timeoutScheduler.setTimeout(() => controller.abort(), this.queryTimeoutMs);

        try {
            // Node's fetch is undici-backed, so it accepts an undici dispatcher
            // at runtime — but the RequestInit type in @types/node maps
            // `dispatcher` through bundled undici-types, which do not structurally
            // match the installed undici Agent. This cast bridges the two; the
            // `NonNullable` indexed access carries `| undefined`, which
            // `exactOptionalPropertyTypes` rejects.
            const init: RequestInit = {
                method: 'GET',
                headers,
                signal: controller.signal,
                ...(this.dispatcher !== undefined
                    ? { dispatcher: this.dispatcher as unknown as NonNullable<RequestInit['dispatcher']> }
                    : {}),
            };
            const res = await this.httpClient.fetch(url.toString(), init);
            this.timeoutScheduler.clearTimeout(timeoutId);
            if (!res.ok) {
                return null;
            }
            const body = (await res.json()) as unknown;
            return parseQueryResponse(body);
        } catch {
            this.timeoutScheduler.clearTimeout(timeoutId);
            return null;
        }
    }
}
