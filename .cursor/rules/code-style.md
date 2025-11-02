---
description: Code style and formatting guidelines
globs: ['**/*.ts', '**/*.js', '**/*.json']
alwaysApply: true
---

# Code Style Guidelines

## Formatting

- **Prettier**: All code is formatted with Prettier
- **ESLint**: Code must pass ESLint checks
- Run `npm run format` before committing
- Run `npm run lint` to check for issues

## Naming Conventions

- **Classes**: PascalCase (e.g., `DeconzClient`, `ShellyClient`)
- **Interfaces/Types**: PascalCase (e.g., `AccessoryConfig`, `ThermostatState`)
- **Functions/Methods**: camelCase (e.g., `getTemperature`, `setState`)
- **Variables**: camelCase (e.g., `currentTemperature`, `targetState`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `TEMPERATURE_WINDOW`, `PLATFORM_NAME`)
- **Private members**: Use `private readonly` prefix, camelCase naming

## Code Organization

- One class per file
- One interface/type per file (or related types grouped together)
- Export only what's needed
- Use named exports for better tree-shaking

## Self-Explanatory Code Philosophy

**Primary principle**: Write code that explains itself through clear naming, structure, and type information. Comments should only be used when they add value beyond what the code already communicates.

### Writing Self-Explanatory Code

- **Use descriptive names**: Variable, function, and class names should clearly express their purpose
- **Leverage TypeScript types**: Types provide documentation - use them effectively
- **Break down complex logic**: Split complex operations into well-named functions
- **Use meaningful constants**: Extract magic numbers and strings into named constants
- **Structure code logically**: Organize code flow to tell a story

### When to Comment

- **Non-obvious behavior**: When the "why" isn't clear from the code itself
- **Business logic context**: When code implements domain-specific rules that aren't obvious
- **Workarounds**: When implementing temporary fixes or workarounds for external issues
- **Public APIs**: JSDoc for exported functions/classes that are part of the public API
- **Complex algorithms**: When implementing algorithms that require explanation beyond the code

### When NOT to Comment

- **Obvious code**: If the code clearly states what it does, don't restate it
- **Self-explanatory operations**: Simple operations like `const temperature = sensor.getTemperature()`
- **Type information**: TypeScript types already document this - don't duplicate
- **Implementation details**: Code should speak for itself

### Examples

```typescript
// ❌ Bad: Comment restates the obvious
// Get the temperature from the sensor
const temperature = sensor.getTemperature();

// ✅ Good: Self-explanatory code, no comment needed
const currentTemperature = this.deconzClient.getTemperature();

// ❌ Bad: Comment explains what the code does
// Multiply by 100 to convert to centidegrees
const centidegrees = temperature * 100;

// ✅ Good: Extract to named constant with clear purpose
const TEMPERATURE_SCALE_FACTOR = 100;
const centidegrees = temperature * TEMPERATURE_SCALE_FACTOR;

// ✅ Good: Comment explains WHY (non-obvious behavior)
// Retry with exponential backoff because the Shelly device
// may be temporarily unavailable during firmware updates
const retryConfig = { count: 10, delay: 1000 };

// ✅ Good: JSDoc for public API (external interface)
/**
 * Retrieves the current temperature reading from the deCONZ sensor.
 * Temperature is returned in Celsius as a decimal number.
 */
public getTemperature(): Observable<number> {
    return this.state.pipe(
        map((sensorInfo) => sensorInfo.state.temperature / TEMPERATURE_SCALE_FACTOR)
    );
}
```

## Spacing and Indentation

- Use 4 spaces for indentation (as configured in Prettier)
- Add blank lines between logical sections
- Keep lines under 120 characters when possible
- Break long lines appropriately

## File Organization

- Imports at the top
- Type/interface definitions before implementation
- Constants after imports
- Classes and functions follow

## Example File Structure

```typescript
// External imports
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

// Internal imports
import { DeconzSensorInfo } from '../interfaces/deconz';

// Constants
const DEFAULT_TIMEOUT = 5000;

// Types/Interfaces (if not in separate file)
type ClientConfig = {
    host: string;
    id: number;
};

// Class implementation
export class DeconzClient {
    // ...
}
```

## Error Messages

- Use descriptive error messages
- Include context when available
- Use proper error types (Error, TypeError, etc.)
- Log errors appropriately using the logger instance

## Consistency

- Follow existing code patterns in the codebase
- Maintain consistency with Homebridge plugin conventions
- When in doubt, follow TypeScript and JavaScript best practices
