import { describe, it, expect } from 'vitest';
import { createGen23RpcDriver } from './gen23-rpc-driver.ts';
import type { HttpClient } from '../runtime/dependencies.ts';

describe('createGen23RpcDriver', () => {
    it('calls POST to /rpc with Switch.Set for setOn', async () => {
        let capturedUrl = '';
        let capturedBody = '';
        const httpClient: HttpClient = {
            fetch: async (url: string, options) => {
                capturedUrl = url;
                capturedBody = typeof options?.body === 'string' ? options.body : '';
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ result: null }),
                };
            },
        };
        const driver = createGen23RpcDriver({
            host: '192.168.1.1',
            switchId: 0,
            requestTimeoutMs: 5000,
            deps: { httpClient },
        });
        await driver.setOn(true);
        expect(capturedUrl).toContain('/rpc');
        const body = JSON.parse(capturedBody) as { method: string; params?: { id: number; on: boolean } };
        expect(body.method).toBe('Switch.Set');
        expect(body.params?.id).toBe(0);
        expect(body.params?.on).toBe(true);
    });

    it('getOn returns output from Switch.GetStatus', async () => {
        const httpClient: HttpClient = {
            fetch: async (_url: string, options) => {
                const body = typeof options?.body === 'string' ? JSON.parse(options.body) : {};
                if (typeof body === 'object' && body && 'method' in body && body.method === 'Switch.GetStatus') {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            result: { id: 0, output: true },
                        }),
                    };
                }
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ result: null }),
                };
            },
        };
        const driver = createGen23RpcDriver({
            host: 'shelly.local',
            switchId: 0,
            requestTimeoutMs: 5000,
            deps: { httpClient },
        });
        const on = await driver.getOn();
        expect(on).toBe(true);
    });

    it('getOn returns false when result missing or output false', async () => {
        const driver = createGen23RpcDriver({
            host: 'shelly.local',
            switchId: 0,
            requestTimeoutMs: 5000,
            deps: {
                httpClient: {
                    fetch: async () => ({
                        ok: true,
                        status: 200,
                        json: async () => ({ result: { id: 0, output: false } }),
                    }),
                } as HttpClient,
            },
        });
        const on = await driver.getOn();
        expect(on).toBe(false);
    });

    it('setOn throws when HTTP is not ok', async () => {
        const driver = createGen23RpcDriver({
            host: 'shelly.local',
            switchId: 0,
            requestTimeoutMs: 5000,
            deps: {
                httpClient: {
                    fetch: async () => ({
                        ok: false,
                        status: 502,
                        json: async () => ({}),
                    }),
                } as HttpClient,
            },
        });
        await expect(driver.setOn(true)).rejects.toThrow('HTTP 502');
    });
});
