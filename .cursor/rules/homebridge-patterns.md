---
description: Homebridge plugin development patterns and conventions
globs: ['src/**/*.ts']
alwaysApply: false
---

# Homebridge Plugin Patterns

## Platform Plugin Structure

This is a **Dynamic Platform Plugin** that:

- Implements `DynamicPlatformPlugin` interface
- Registers accessories dynamically based on configuration
- Handles accessory caching and restoration
- Manages multiple accessories per platform instance

## Plugin Registration

```typescript
// Main entry point pattern
export = (homebridge: API): void => {
    homebridge.registerPlatform(PLUGIN_IDENTIFIED, PLATFORM_NAME, HomebridgeHeatingPlatform);
};
```

## Platform Class Pattern

- Accepts `logger`, `config`, and `api` in constructor
- Validates configuration on initialization
- Uses `didFinishLaunching` callback for device discovery
- Implements `configureAccessory` for cached accessories

## Accessory Management

- Generate UUIDs using `api.hap.uuid.generate()` based on unique identifiers
- Check for existing accessories before creating new ones
- Use `platformAccessory` factory method to create accessories
- Set appropriate category (e.g., `Categories.THERMOSTAT`)
- Register accessories with `registerPlatformAccessories()`

## Service and Characteristic Setup

- Use `getService()` or `addService()` to get/create services
- Access characteristics using `getCharacteristic()`
- Set up `get` handlers for HomeKit reads
- Set up `set` handlers for HomeKit writes
- Update characteristics when state changes

## Logging

- Use the provided `logger` instance (not `console.log`)
- Use appropriate log levels:
    - `logger.debug()`: Debug information
    - `logger.info()`: General information
    - `logger.warn()`: Warnings
    - `logger.error()`: Errors
- Include context in log messages

## Configuration Validation

- Always validate configuration using Zod schemas
- Provide clear error messages for invalid configuration
- Handle missing or malformed configuration gracefully
- Log configuration errors to help users debug

## Lifecycle Management

- Listen for `shutdown` events to clean up resources
- Unsubscribe from observables on shutdown
- Release resources properly
- Handle plugin unload gracefully

## Characteristic Update Pattern

```typescript
// Update characteristic when state changes
const characteristic = this.thermostat?.getCharacteristic(this.Characteristic.CurrentTemperature);
if (characteristic) {
    characteristic.setValue(temperature);
}

// Handle HomeKit reads
characteristic.on('get', (callback) => {
    callback(null, this.homekitState.getValue().currentTemperature);
});

// Handle HomeKit writes
characteristic.on('set', (value: CharacteristicValue, callback) => {
    if (typeof value === 'number') {
        this.updateState(value);
    }
    callback();
});
```

## Best Practices

- Always check if service/characteristic exists before accessing
- Handle characteristic callbacks properly (call with null for success, Error for failure)
- Update characteristics reactively when internal state changes
- Keep HomeKit state in sync with device state
- Handle network errors gracefully
- Don't block the event loop with synchronous operations
