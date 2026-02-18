import { describe, it, expect } from 'vitest';
import { createGen1Driver } from './gen1-driver.ts';
import type { HttpClient } from '../runtime/dependencies.ts';

function makeFakeHttpClient(
    overrides: Partial<{
        captureUrl: (u: string) => void;
        captureHeaders: (h: Record<string, string>) => void;
        getStatusBody: () => unknown;
    }>,
): HttpClient {
    return {
        fetch: async (url: string, options) => {
            overrides.captureUrl?.(url);
            overrides.captureHeaders?.((options?.headers as Record<string, string>) ?? {});
            const body = overrides.getStatusBody?.() ?? {};
            return {
                ok: true,
                status: 200,
                json: async () => body,
            };
        },
    };
}

describe('createGen1Driver', () => {
    it('calls GET on relay path for setOn(true)', async () => {
        let capturedUrl = '';
        const driver = createGen1Driver({
            host: '192.168.1.1',
            switchId: 0,
            requestTimeoutMs: 5000,
            deps: {
                httpClient: makeFakeHttpClient({ captureUrl: (u) => (capturedUrl = u) }),
            },
        });
        await driver.setOn(true);
        expect(capturedUrl).toContain('/relay/0');
        expect(capturedUrl).toContain('turn=on');
    });

    it('calls GET on relay path for setOn(false)', async () => {
        let capturedUrl = '';
        const driver = createGen1Driver({
            host: '192.168.1.1',
            switchId: 1,
            requestTimeoutMs: 5000,
            deps: {
                httpClient: makeFakeHttpClient({ captureUrl: (u) => (capturedUrl = u) }),
            },
        });
        await driver.setOn(false);
        expect(capturedUrl).toContain('/relay/1');
        expect(capturedUrl).toContain('turn=off');
    });

    it('includes Basic auth header when username and password provided', async () => {
        let capturedHeaders: Record<string, string> = {};
        const driver = createGen1Driver({
            host: 'shelly.local',
            switchId: 0,
            requestTimeoutMs: 5000,
            username: 'user',
            password: 'pass',
            deps: {
                httpClient: makeFakeHttpClient({ captureHeaders: (h) => (capturedHeaders = h) }),
            },
        });
        await driver.setOn(true);
        expect(capturedHeaders['Authorization']).toMatch(/^Basic /);
    });

    it('getOn returns true when relay ison is true', async () => {
        const driver = createGen1Driver({
            host: 'shelly.local',
            switchId: 0,
            requestTimeoutMs: 5000,
            deps: {
                httpClient: makeFakeHttpClient({
                    getStatusBody: () => ({ relays: [{ ison: true }] }),
                }),
            },
        });
        const on = await driver.getOn();
        expect(on).toBe(true);
    });

    it('getOn returns false when relay ison is false', async () => {
        const driver = createGen1Driver({
            host: 'shelly.local',
            switchId: 0,
            requestTimeoutMs: 5000,
            deps: {
                httpClient: makeFakeHttpClient({
                    getStatusBody: () => ({ relays: [{ ison: false }] }),
                }),
            },
        });
        const on = await driver.getOn();
        expect(on).toBe(false);
    });

    it('setOn throws when HTTP is not ok', async () => {
        const driver = createGen1Driver({
            host: 'shelly.local',
            switchId: 0,
            requestTimeoutMs: 5000,
            deps: {
                httpClient: {
                    fetch: async () => ({
                        ok: false,
                        status: 500,
                        json: async () => ({}),
                    }),
                } as HttpClient,
            },
        });
        await expect(driver.setOn(true)).rejects.toThrow('HTTP 500');
    });
});
