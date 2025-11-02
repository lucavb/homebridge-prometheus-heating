---
description: RxJS patterns and best practices for reactive programming
globs: ['**/*.ts']
alwaysApply: false
---

# RxJS Patterns

## Observable Patterns

- Use RxJS 7+ patterns (avoid deprecated APIs)
- Use `from()` instead of deprecated `fromPromise`
- Use `map()` instead of deprecated `pluck`
- Always handle subscriptions properly to prevent memory leaks

## Subscription Management

- Always use `takeUntil()` with a termination Subject for cleanup
- Unsubscribe in `shutdown` handlers or component destruction
- Use `take(1)` for one-time subscriptions
- Consider using `firstValueFrom()` or `lastValueFrom()` for async/await patterns where appropriate

## Error Handling

- Use `catchError()` to handle errors in streams
- Return `EMPTY` when you want to gracefully ignore errors
- Log errors appropriately using the logger instance
- Never let errors propagate unhandled in observables

## Common Operators

- `map()`: Transform values
- `tap()`: Side effects (logging, updating state)
- `switchMap()`: Cancel previous inner observables
- `combineLatest()`: Combine multiple observables
- `takeUntil()`: Complete when signal emits
- `catchError()`: Handle errors
- `retry()`: Retry failed operations
- `timeout()`: Add timeout to operations

## Example Patterns

```typescript
// Good: Proper cleanup with takeUntil
combineLatest([source1$, source2$])
    .pipe(
        map(([val1, val2]) => processValues(val1, val2)),
        tap((result) => this.logger.debug('Result:', result)),
        catchError((error) => {
            this.logger.error('Error:', error);
            return EMPTY;
        }),
        takeUntil(this.terminate),
    )
    .subscribe();

// Good: Using retry for network requests
this.fetch(url)
    .pipe(
        retry({ count: 3, delay: 1000 }),
        timeout(5000),
        catchError((error) => {
            this.logger.error('Request failed:', error);
            return EMPTY;
        }),
    )
    .subscribe();
```

## Subjects

- Use `BehaviorSubject` for state that needs an initial value
- Use `Subject` for event streams
- Use `Subject<void>` for termination signals
- Always call `next()` and `complete()` appropriately

## Common Mistakes to Avoid

- Don't create subscriptions without cleanup
- Don't forget to handle errors in streams
- Don't use deprecated operators (`fromPromise`, `pluck`)
- Don't subscribe without considering memory leaks
- Don't ignore RxJS deprecation warnings
