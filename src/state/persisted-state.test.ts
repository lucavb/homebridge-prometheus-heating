import { describe, expect, it } from 'vitest';
import { loadPersistedState, type PersistedStateDeps, savePersistedState, updateRoomState } from './persisted-state.ts';
import { PathLike } from 'node:fs';

describe('loadPersistedState', () => {
    it('returns default state when file cannot be read', async () => {
        const deps: Partial<PersistedStateDeps> = {
            fs: {
                readFile: async () => {
                    throw new Error('ENOENT');
                },
                writeFile: async () => {},
                mkdir: async () => {},
            },
        };
        const state = await loadPersistedState('/nonexistent', deps);
        expect(state).toEqual({ rooms: {} });
    });

    it('returns default state when content is invalid JSON', async () => {
        const deps: Partial<PersistedStateDeps> = {
            fs: {
                readFile: async () => 'not json',
                writeFile: async () => {},
                mkdir: async () => {},
            },
            json: {
                parse: () => {
                    throw new Error('Invalid JSON');
                },
                stringify: (v: unknown) => JSON.stringify(v),
            },
        };
        const state = await loadPersistedState('/dir', deps);
        expect(state).toEqual({ rooms: {} });
    });

    it('returns default state when content has no valid rooms object', async () => {
        const deps: Partial<PersistedStateDeps> = {
            fs: {
                readFile: async () => '{}',
                writeFile: async () => {},
                mkdir: async () => {},
            },
            path: { join: (...p: string[]) => p.join('/') },
            json: {
                parse: <T>(s: string): T => JSON.parse(s) as T,
                stringify: (v: unknown) => JSON.stringify(v),
            },
        };
        const state = await loadPersistedState('/dir', deps);
        expect(state).toEqual({ rooms: {} });
    });

    it('returns parsed state when file has valid rooms', async () => {
        const deps: Partial<PersistedStateDeps> = {
            fs: {
                readFile: async () => '{"rooms":{"r1":{"relayOn":true,"lastUpdatedMs":1000}}}',
                writeFile: async () => {},
                mkdir: async () => {},
            },
            path: { join: (...p: string[]) => p.join('/') },
            json: {
                parse: <T>(s: string): T => JSON.parse(s) as T,
                stringify: (v: unknown) => JSON.stringify(v),
            },
        };
        const state = await loadPersistedState('/dir', deps);
        expect(state.rooms).toHaveProperty('r1');
        expect(state.rooms['r1']?.relayOn).toBe(true);
        expect(state.rooms['r1']?.lastUpdatedMs).toBe(1000);
    });
});

describe('savePersistedState', () => {
    it('calls mkdir and writeFile with path and stringified state', async () => {
        const mkdirCalls: PathLike[] = [];
        const writeCalls: Array<{ path: string; content: string }> = [];
        const deps: Partial<PersistedStateDeps> = {
            fs: {
                readFile: async () => '',
                mkdir: (path: PathLike) => {
                    mkdirCalls.push(path);
                    return Promise.resolve(void 0);
                },
                writeFile: async (path: string, content: string) => {
                    writeCalls.push({ path, content });
                },
            },
            path: { join: (...p: string[]) => p.join('/') },
            json: {
                parse: <T>(s: string): T => JSON.parse(s) as T,
                stringify: (v: unknown) => JSON.stringify(v),
            },
        };
        await savePersistedState('/persist', { rooms: { room1: { relayOn: true, lastUpdatedMs: 123 } } }, deps);
        expect(mkdirCalls).toContain('/persist');
        expect(writeCalls.length).toBe(1);
        expect(writeCalls[0]?.path).toContain('prometheus-heating-state');
        expect(JSON.parse(writeCalls[0]?.content ?? '{}').rooms.room1.relayOn).toBe(true);
    });
});

describe('updateRoomState', () => {
    it('adds room state with injected clock now', () => {
        const fixedNow = 99999;
        const state = updateRoomState({ rooms: {} }, 'room1', true, { clock: { now: () => fixedNow } });
        expect(state.rooms['room1']).toEqual({ relayOn: true, lastUpdatedMs: fixedNow });
    });

    it('overwrites existing room state', () => {
        const state = updateRoomState({ rooms: { room1: { relayOn: false, lastUpdatedMs: 0 } } }, 'room1', true, {
            clock: { now: () => 111 },
        });
        expect(state.rooms['room1']).toEqual({ relayOn: true, lastUpdatedMs: 111 });
    });
});
