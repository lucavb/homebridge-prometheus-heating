---
description: Testing standards and best practices using Vitest
globs: ['**/*.spec.ts', '**/*.test.ts']
alwaysApply: false
---

# Testing Standards

## Test Framework

- Use **Vitest** for all tests
- Test files use `.spec.ts` suffix (e.g., `deconz.spec.ts`)
- Place test files next to the code they test (e.g., `src/lib/deconz.spec.ts`)

## Test Structure

- Use `describe()` blocks to group related tests
- Use `it()` or `test()` for individual test cases
- Use descriptive test names that explain what is being tested
- Follow Arrange-Act-Assert pattern

## Mocking

- Mock external dependencies (fetch, Homebridge API)
- Use Vitest's `vi.mock()` for module mocking
- Mock HTTP requests using `vi.fn()` or `fetchMock`
- Mock Homebridge API types appropriately

## Test Coverage

- Aim for high coverage of critical paths
- Test error cases, not just happy paths
- Test edge cases and boundary conditions
- Mock external APIs and services

## Example Test Structure

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeconzClient } from './deconz';

describe('DeconzClient', () => {
    let client: DeconzClient;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockFetch = vi.fn();
        client = new DeconzClient('localhost:80', 'test-user', 1, mockFetch);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should fetch temperature from deCONZ API', async () => {
        // Arrange
        const mockResponse = { state: { temperature: 2150 } };
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => mockResponse,
        });

        // Act
        const temperature = await firstValueFrom(client.getTemperature());

        // Assert
        expect(temperature).toBe(21.5);
        expect(mockFetch).toHaveBeenCalledWith('http://localhost:80/api/test-user/sensors/1');
    });

    it('should handle HTTP errors gracefully', async () => {
        // Arrange
        mockFetch.mockResolvedValue({
            ok: false,
            status: 404,
        });

        // Act & Assert
        await expect(firstValueFrom(client.getTemperature())).rejects.toThrow();
    });
});
```

## Best Practices

- Keep tests independent - each test should be able to run in isolation
- Clean up after tests (reset mocks, unsubscribe from observables)
- Use `beforeEach` and `afterEach` for setup/teardown
- Test both success and failure scenarios
- Use meaningful assertions with descriptive messages
- Test observable streams properly (use `firstValueFrom` or `lastValueFrom`)

## Running Tests

- `npm test` - Run tests once
- `npm run test:watch` - Watch mode for development
- `npm run test:ui` - Run tests with UI
- `npm run test:coverage` - Generate coverage report

## Testing RxJS Code

- Use `firstValueFrom()` or `lastValueFrom()` to convert observables to promises
- Test error handling with `catchError()` and `rejects`
- Mock observables using `of()`, `throwError()`, `EMPTY` from RxJS
- Test subscription cleanup and termination
