---
description: TypeScript coding standards and best practices
globs: ['**/*.ts']
alwaysApply: false
---

# TypeScript Standards

## Type Safety

- **Strict mode**: Always enabled - respect strict null checks and type safety
- **Avoid `any`**: Use proper types or `unknown` if type is truly unknown
- **Use `noUncheckedIndexedAccess`**: Always check for undefined when accessing array/object indices
- **Explicit return types**: Consider adding return types for public methods, especially in interfaces

## Type Definitions

- Define interfaces in `src/interfaces/` directory
- Use `interface` for object shapes that can be extended
- Use `type` for unions, intersections, and computed types
- Export types/interfaces that are used across modules

## Code Style

- Use `const` for immutable values, `let` for mutable values
- Prefer `const` assertions (`as const`) for literal types
- Use optional chaining (`?.`) and nullish coalescing (`??`) appropriately
- Use template literals for string interpolation
- **Write self-explanatory code**: Use descriptive names and clear structure - avoid comments that restate the obvious

## Import Organization

- Group imports: external packages first, then internal modules
- Use absolute imports when possible (if configured)
- Avoid circular dependencies

## Example Patterns

```typescript
// Good: Self-explanatory function name and return type
const getAccessoryValue = (config: AccessoryConfig): number | undefined => {
    return config.value;
};

// Good: Function name clearly indicates validation purpose
const validateConfig = (config: unknown): HomebridgeHeatingConfig => {
    return configSchema.parse(config);
};

// Good: Descriptive variable name with explicit type
const temperatureObservable: Observable<number> = this.deconzClient.getTemperature();
```

## Common Patterns to Avoid

- Don't use `any` - use `unknown` and type guards instead
- Don't ignore TypeScript errors with `@ts-ignore` - fix the underlying issue
- Don't use `as` type assertions unless absolutely necessary - prefer type guards
- Don't access properties without checking for undefined when using `noUncheckedIndexedAccess`
