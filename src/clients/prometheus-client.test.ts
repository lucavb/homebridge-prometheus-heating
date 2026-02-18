import { describe, it, expect } from 'vitest';
import { PrometheusClient } from './prometheus-client.ts';
import type { HttpClient, HttpClientResponse } from '../runtime/dependencies.ts';

function fakeHttpClient(responses: HttpClientResponse[]): HttpClient {
    let index = 0;
    return {
        fetch: async (_url: string) => {
            const res = responses[index] ?? responses[0];
            index += 1;
            return res!;
        },
    } as unknown as HttpClient;
}

describe('PrometheusClient', () => {
    it('parses vector result and returns value and timestamp', async () => {
        const body = {
            data: {
                resultType: 'vector',
                result: [{ value: [1700000000, 21.5] }],
            },
        };
        const client = new PrometheusClient({
            baseUrl: 'http://prom:9090',
            queryTimeoutMs: 5000,
            deps: {
                httpClient: fakeHttpClient([
                    {
                        ok: true,
                        status: 200,
                        json: async () => body,
                    },
                ]),
            },
        });
        const result = await client.query('room_temp');
        expect(result).not.toBeNull();
        expect(result?.value).toBe(21.5);
        expect(result?.timestampMs).toBe(1700000000 * 1000);
    });

    it('parses scalar result', async () => {
        const body = {
            data: {
                resultType: 'scalar',
                result: [1700000000, 19.2],
            },
        };
        const client = new PrometheusClient({
            baseUrl: 'http://prom:9090',
            queryTimeoutMs: 5000,
            deps: {
                httpClient: fakeHttpClient([
                    {
                        ok: true,
                        status: 200,
                        json: async () => body,
                    },
                ]),
            },
        });
        const result = await client.query('temp');
        expect(result).not.toBeNull();
        expect(result?.value).toBe(19.2);
        expect(result?.timestampMs).toBe(1700000000 * 1000);
    });

    it('returns null when response is not ok', async () => {
        const client = new PrometheusClient({
            baseUrl: 'http://prom:9090',
            queryTimeoutMs: 5000,
            deps: {
                httpClient: fakeHttpClient([
                    {
                        ok: false,
                        status: 500,
                        json: async () => ({}),
                    },
                ]),
            },
        });
        const result = await client.query('temp');
        expect(result).toBeNull();
    });

    it('returns null for malformed response body', async () => {
        const client = new PrometheusClient({
            baseUrl: 'http://prom:9090',
            queryTimeoutMs: 5000,
            deps: {
                httpClient: fakeHttpClient([
                    {
                        ok: true,
                        status: 200,
                        json: async () => ({ data: { resultType: 'vector', result: [] } }),
                    },
                ]),
            },
        });
        const result = await client.query('temp');
        expect(result).toBeNull();
    });

    it('includes bearer token in headers when auth configured', async () => {
        let capturedHeaders: Record<string, string> = {};
        const client = new PrometheusClient({
            baseUrl: 'http://prom:9090',
            queryTimeoutMs: 5000,
            auth: { mode: 'bearer', bearerToken: 'secret' },
            deps: {
                httpClient: {
                    fetch: async (_url: string, options) => {
                        capturedHeaders = (options?.headers as Record<string, string>) ?? {};
                        return {
                            ok: true,
                            status: 200,
                            json: async () => ({
                                data: { resultType: 'scalar', result: [0, 20] },
                            }),
                        };
                    },
                },
            },
        });
        await client.query('temp');
        expect(capturedHeaders['Authorization']).toBe('Bearer secret');
    });
});
