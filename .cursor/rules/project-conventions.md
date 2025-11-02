---
description: General project conventions and guidelines for homebridge-heating plugin
globs: ['**/*']
alwaysApply: true
---

# Project Conventions

This is a Homebridge platform plugin for controlling heating systems using deCONZ temperature sensors and Shelly relay switches.

## Project Structure

- **Source files**: Located in `src/` directory
- **Compiled output**: Located in `dist/` directory (do not edit directly)
- **Tests**: Test files use `.spec.ts` suffix (e.g., `deconz.spec.ts`)
- **Interfaces**: Type definitions are in `src/interfaces/` directory
- **Library code**: Reusable modules are in `src/lib/` directory

## Key Technologies

- **TypeScript**: Strict mode enabled, ES2022 target
- **RxJS**: Used for reactive programming with observables
- **Zod**: Used for runtime validation and configuration parsing
- **Vitest**: Testing framework
- **ESLint**: Code linting with flat config format
- **Prettier**: Code formatting

## Important Guidelines

1. **Write self-explanatory code** - Code should explain itself through clear naming, structure, and types. Only add comments when they provide value beyond what the code communicates (non-obvious behavior, business logic context, workarounds, or public API documentation)
2. **Always compile TypeScript before committing** - Run `npm run build` to ensure the `dist/` directory is up to date
3. **Run tests before committing** - Use `npm test` or `npm run test:watch` during development
4. **Type safety is critical** - Use strict TypeScript settings, avoid `any` types
5. **Error handling** - Always handle errors properly, especially in API calls and RxJS streams
6. **Logging** - Use the Homebridge logger instance, not `console.log`
7. **Configuration validation** - Always validate configuration using Zod schemas before use

## Homebridge Plugin Patterns

- This is a **platform plugin** (not an accessory plugin)
- Implements `DynamicPlatformPlugin` interface
- Creates accessories dynamically based on configuration
- Uses Homebridge's `PlatformAccessory` for accessory management
- Properly handles accessory caching and restoration

## API Integration

- **deCONZ**: Temperature sensor integration via HTTP API
- **Shelly**: Relay control via HTTP API
- Always handle network errors and timeouts
- Use RxJS operators for retry logic and error handling
- Never expose sensitive credentials in logs
