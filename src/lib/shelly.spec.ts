import { describe, it, expect, vi, beforeEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { ShellyClient } from './shelly';
import { ShellyRelayResponse } from '../interfaces/shelly';

describe('ShellyClient', () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockFetch = vi.fn();
    });

    it('should create a ShellyClient instance', () => {
        const client = new ShellyClient('localhost', 0, mockFetch as typeof fetch);
        expect(client).toBeInstanceOf(ShellyClient);
    });

    it('should get relay state', async () => {
        const mockResponse: ShellyRelayResponse = {
            ison: true,
            has_timer: false,
            timer_started: 0,
            timer_duration: 0,
            timer_remaining: 0,
            overpower: false,
            overtemperature: false,
            is_valid: true,
            source: 'http',
        };

        mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(mockResponse)));

        const client = new ShellyClient('localhost', 0, mockFetch as typeof fetch);
        const state$ = client.getState();

        const state = await firstValueFrom(state$);

        expect(mockFetch).toHaveBeenCalledWith('http://localhost/relay/0');
        expect(state).toBe(true);
    });

    it('should set relay state', async () => {
        const mockResponse = {
            has_timer: false,
            is_valid: true,
            ison: true,
            overpower: false,
            overtemperature: false,
            source: 'http',
            timer_duration: 0,
            timer_remaining: 0,
            timer_started: 0,
        } as const satisfies ShellyRelayResponse;

        mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(mockResponse)));

        const client = new ShellyClient('localhost', 0, mockFetch as typeof fetch);
        const state$ = client.setState(true);

        const state = await firstValueFrom(state$);

        expect(mockFetch).toHaveBeenCalledWith('http://localhost/relay/0?turn=on');
        expect(state).toBe(true);
    });

    it('should retry fetch requests on network failure', async () => {
        const mockResponse: ShellyRelayResponse = {
            ison: true,
            has_timer: false,
            timer_started: 0,
            timer_duration: 0,
            timer_remaining: 0,
            overpower: false,
            overtemperature: false,
            is_valid: true,
            source: 'http',
        };

        mockFetch
            .mockRejectedValueOnce(new Error('Network error'))
            .mockRejectedValueOnce(new Error('Network error'))
            .mockResolvedValueOnce(new Response(JSON.stringify(mockResponse)));

        const client = new ShellyClient('localhost', 0, mockFetch as typeof fetch);
        const state$ = client.getState();

        const state = await firstValueFrom(state$);

        expect(mockFetch).toHaveBeenCalledTimes(3);
        expect(state).toBe(true);
    });

    it('should retry setState on network failure', async () => {
        const mockResponse: ShellyRelayResponse = {
            ison: false,
            has_timer: false,
            timer_started: 0,
            timer_duration: 0,
            timer_remaining: 0,
            overpower: false,
            overtemperature: false,
            is_valid: true,
            source: 'http',
        };

        mockFetch
            .mockRejectedValueOnce(new Error('Network error'))
            .mockResolvedValueOnce(new Response(JSON.stringify(mockResponse)));

        const client = new ShellyClient('localhost', 0, mockFetch as typeof fetch);
        const state$ = client.setState(false);

        const state = await firstValueFrom(state$);

        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(mockFetch).toHaveBeenCalledWith('http://localhost/relay/0?turn=off');
        expect(state).toBe(false);
    });
});
