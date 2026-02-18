import type { PluginConfig } from '../config/schema.ts';
import type { RoomControllerDeps } from './types.ts';
import { PrometheusClient } from '../clients/prometheus-client';

export function createPrometheusClientFromConfig(
    config: PluginConfig,
    deps: Pick<RoomControllerDeps, 'createPrometheusClient'>,
) {
    const auth = config.prometheus.auth;
    return deps.createPrometheusClient({
        baseUrl: config.prometheus.baseUrl,
        queryTimeoutMs: config.prometheus.queryTimeoutMs,
        auth:
            auth.mode === 'bearer' && auth.bearerToken
                ? { mode: 'bearer', bearerToken: auth.bearerToken }
                : { mode: 'none' },
        allowInsecureTls: config.prometheus.allowInsecureTls,
    }) satisfies PrometheusClient;
}
