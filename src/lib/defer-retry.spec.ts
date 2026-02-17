import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defer, firstValueFrom, from } from 'rxjs';
import { retry } from 'rxjs/operators';

describe('Defer Retry Pattern', () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockFetch = vi.fn();
    });

    it('should NOT retry with from() - promise executes only once', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error')).mockResolvedValueOnce(new Response('success'));

        const observable$ = from((mockFetch as typeof fetch)('http://example.com')).pipe(
            retry({ count: 3, delay: 10 }),
        );

        await expect(firstValueFrom(observable$)).rejects.toThrow('Network error');

        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should retry with defer() - promise re-executed on each attempt', async () => {
        mockFetch
            .mockRejectedValueOnce(new Error('Network error'))
            .mockRejectedValueOnce(new Error('Network error'))
            .mockResolvedValueOnce(new Response('success'));

        const observable$ = defer(() => from((mockFetch as typeof fetch)('http://example.com'))).pipe(
            retry({ count: 3, delay: 10 }),
        );

        const result = await firstValueFrom(observable$);

        expect(mockFetch).toHaveBeenCalledTimes(3);
        expect(result).toBeInstanceOf(Response);
    });

    it('should retry multiple times until success', async () => {
        let callCount = 0;
        const mockOperation = vi.fn(() => {
            callCount++;
            if (callCount < 5) {
                return Promise.reject(new Error(`Failure ${callCount}`));
            }
            return Promise.resolve({ success: true, attempt: callCount });
        });

        const observable$ = defer(() => from(mockOperation())).pipe(retry({ count: 10, delay: 10 }));

        const result = await firstValueFrom(observable$);

        expect(mockOperation).toHaveBeenCalledTimes(5);
        expect(result).toEqual({ success: true, attempt: 5 });
    });

    it('should fail after exhausting retries', async () => {
        mockFetch.mockRejectedValue(new Error('Persistent error'));

        const observable$ = defer(() => from((mockFetch as typeof fetch)('http://example.com'))).pipe(
            retry({ count: 3, delay: 10 }),
        );

        await expect(firstValueFrom(observable$)).rejects.toThrow('Persistent error');

        expect(mockFetch).toHaveBeenCalledTimes(4);
    });
});
