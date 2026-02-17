import { describe, it, expect, vi, beforeEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { DeconzClient } from './deconz';
import { DeconzSensorInfo } from '../interfaces/deconz';

describe('DeconzClient', () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockFetch = vi.fn();
    });

    it('should create a DeconzClient instance', () => {
        const client = new DeconzClient('localhost', 'testuser', 1, mockFetch as typeof fetch);
        expect(client).toBeInstanceOf(DeconzClient);
    });

    it('should fetch temperature data', async () => {
        const mockResponse: DeconzSensorInfo = {
            config: {
                battery: 100,
                offset: 0,
                on: true,
                reachable: true,
            },
            ep: 1,
            etag: 'test-etag',
            lastseen: '2024-01-01T00:00:00Z',
            manufacturername: 'Test',
            modelid: 'test-model',
            name: 'Test Sensor',
            state: {
                lastupdated: new Date(),
                temperature: 2500,
            },
            swversion: '1.0',
            type: 'ZHATemperature',
            uniqueid: 'test-id',
        };

        mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(mockResponse)));

        const client = new DeconzClient('localhost', 'testuser', 1, mockFetch as typeof fetch);

        const temperature$ = client.getTemperature();
        const temperature = await firstValueFrom(temperature$);

        expect(mockFetch).toHaveBeenCalledWith('http://localhost/api/testuser/sensors/1');
        expect(temperature).toBe(25);
    });
});
