# homebridge-deconz-shelly-thermostat

[![npm version](https://img.shields.io/npm/v/homebridge-deconz-shelly-thermostat.svg)](https://www.npmjs.com/package/homebridge-deconz-shelly-thermostat)
[![License](https://img.shields.io/npm/l/homebridge-deconz-shelly-thermostat.svg)](LICENSE)

A Homebridge platform plugin that creates HomeKit thermostat accessories by combining deCONZ temperature sensors with Shelly relay switches for automatic heating control.

## Overview

This plugin bridges the gap between deCONZ temperature sensors and Shelly relay switches to create fully functional HomeKit thermostats. It monitors temperature readings from your deCONZ sensors and automatically controls heating via Shelly relays based on your target temperature settings.

### Primary Use Case: Infloor Heating Automation

**This plugin is specifically designed for infloor heating systems** that can be easily automated using Shelly relay switches. If you have:

- **Infloor heating** (radiant floor heating, electric floor heating, etc.)
- **Shelly relays** controlling your heating zones
- **deCONZ temperature sensors** monitoring room temperatures

Then this plugin is perfect for you! It provides a simple way to convert your existing setup into smart, HomeKit-compatible thermostats without needing expensive proprietary systems.

Shelly relays are ideal for infloor heating automation because they:

- Can handle high-power loads required for heating systems
- Are easily integrated into existing electrical setups
- Provide reliable on/off control
- Are cost-effective compared to dedicated heating controllers

Perfect for:

- **Infloor heating systems** with zone-based control
- Converting existing deCONZ sensors and Shelly switches into smart thermostats
- Multi-room heating automation
- HomeKit integration for custom heating setups

## Features

- 🏠 **Platform Plugin Architecture**: Support for multiple thermostat accessories
- 🌡️ **deCONZ Integration**: Reads temperature from deCONZ sensors
- 🔌 **Shelly Control**: Controls heating via Shelly relay switches
- 🤖 **Automatic Control**: Automatically adjusts heating based on temperature differential
- ⏱️ **Real-time Updates**: Temperature readings updated every 2 minutes
- 🎯 **Configurable Threshold**: Temperature window (default: 0.5°C) prevents rapid cycling
- 🏘️ **Multi-Zone Support**: Configure multiple heating zones independently

## Requirements

- Node.js >= 22.0.0
- Homebridge >= 1.7.0
- deCONZ gateway with temperature sensor(s)
- Shelly device(s) with relay control

## Installation

1. Install Homebridge (if not already installed):

    ```bash
    npm install -g homebridge
    ```

2. Install this plugin:

    ```bash
    npm install -g homebridge-deconz-shelly-thermostat
    ```

3. Configure the plugin in your Homebridge `config.json` (see [Configuration](#configuration) below)

4. Restart Homebridge

## Configuration

Add the platform configuration to your Homebridge `config.json` file:

```json
{
    "platforms": [
        {
            "platform": "DeconzShellyThermostat",
            "name": "Heating",
            "accessories": [
                {
                    "name": "Living Room Heating",
                    "deconz": {
                        "host": "192.168.1.100:80",
                        "user": "your-deconz-api-key",
                        "id": 1
                    },
                    "shelly": {
                        "host": "192.168.1.101",
                        "relay": 0
                    },
                    "temperatureWindow": 0.5
                }
            ]
        }
    ]
}
```

### Platform Configuration

| Field         | Type   | Required | Description                        |
| ------------- | ------ | -------- | ---------------------------------- |
| `platform`    | string | Yes      | Must be `"DeconzShellyThermostat"` |
| `name`        | string | Yes      | Display name for the platform      |
| `accessories` | array  | Yes      | Array of accessory configurations  |

### Accessory Configuration

Each accessory in the `accessories` array requires:

| Field               | Type   | Required | Description                                                              |
| ------------------- | ------ | -------- | ------------------------------------------------------------------------ |
| `name`              | string | Yes      | Display name for the thermostat accessory                                |
| `deconz`            | object | Yes      | deCONZ sensor configuration                                              |
| `shelly`            | object | Yes      | Shelly device configuration                                              |
| `temperatureWindow` | number | No       | Temperature window in °C (default: 0.5). Controls when heating activates |

#### deCONZ Configuration

| Field  | Type   | Required | Description                                               |
| ------ | ------ | -------- | --------------------------------------------------------- |
| `host` | string | Yes      | deCONZ gateway host and port (e.g., `"192.168.1.100:80"`) |
| `user` | string | Yes      | deCONZ API key/username                                   |
| `id`   | number | Yes      | Sensor ID number from deCONZ                              |

#### Shelly Configuration

| Field   | Type   | Required | Description                                |
| ------- | ------ | -------- | ------------------------------------------ |
| `host`  | string | Yes      | Shelly device IP address or hostname       |
| `relay` | number | Yes      | Relay number (`0` or `1` for most devices) |

### Multiple Zones Example

Configure multiple heating zones by adding multiple accessories:

```json
{
    "platforms": [
        {
            "platform": "DeconzShellyThermostat",
            "name": "Heating",
            "accessories": [
                {
                    "name": "Living Room Heating",
                    "deconz": {
                        "host": "192.168.1.100:80",
                        "user": "your-deconz-api-key",
                        "id": 1
                    },
                    "shelly": {
                        "host": "192.168.1.101",
                        "relay": 0
                    }
                },
                {
                    "name": "Bedroom Heating",
                    "deconz": {
                        "host": "192.168.1.100:80",
                        "user": "your-deconz-api-key",
                        "id": 2
                    },
                    "shelly": {
                        "host": "192.168.1.102",
                        "relay": 0
                    }
                }
            ]
        }
    ]
}
```

## How It Works

1. **Temperature Monitoring**: The plugin polls the deCONZ sensor every 2 minutes to get current temperature readings

2. **Target Temperature**: Users set the desired temperature via the Home app or HomeKit automation

3. **Automatic Control**: The plugin compares the current temperature with the target temperature:
    - If the difference exceeds the configured temperature window (default: 0.5°C) below target, heating is activated
    - If the temperature reaches or exceeds the target, heating is turned off

4. **State Management**: The plugin maintains the heating state and updates HomeKit characteristics accordingly

5. **Error Handling**: Network errors are handled gracefully, and the plugin continues operating

## Usage

Once configured, your thermostats will appear in the Home app and can be controlled like any other HomeKit thermostat:

- Set target temperature
- Turn heating on/off
- View current temperature
- Use in HomeKit automations and scenes
- Control via Siri

## Troubleshooting

### Plugin Not Appearing

- Verify the platform configuration is correct in `config.json`
- Check that all required fields are present
- Review Homebridge logs for configuration errors
- Ensure the platform name matches exactly: `"DeconzShellyThermostat"`

### Temperature Not Updating

- **Check deCONZ connectivity**: Verify the gateway is accessible at the configured host
- **Verify API key**: Ensure the deCONZ API key is correct
- **Check sensor ID**: Confirm the sensor ID matches the sensor in deCONZ
- **Network issues**: Ensure the Homebridge server can reach the deCONZ gateway
- **Check logs**: Look for error messages in Homebridge logs

### Heating Not Controlling

- **Check Shelly connectivity**: Verify the Shelly device is accessible
- **Verify relay number**: Confirm the relay number is correct (usually `0` or `1`)
- **Network connectivity**: Ensure the Homebridge server can reach the Shelly device
- **Check device state**: Verify the Shelly device is responding to API calls
- **Review logs**: Check Homebridge logs for error messages

### Temperature Window

The plugin uses a configurable temperature window (default: 0.5°C) to prevent rapid cycling. This means:

- Heating turns on when temperature is more than the configured window below target
- Heating turns off when temperature reaches or exceeds target

This prevents the relay from rapidly switching on/off when temperature is near the target.

You can configure the temperature window per accessory by adding the `temperatureWindow` field to your accessory configuration. The value must be a positive number (in °C). For example, to use a 1.0°C window:

```json
{
    "name": "Living Room Heating",
    "temperatureWindow": 1.0,
    "deconz": { ... },
    "shelly": { ... }
}
```

### Finding deCONZ Sensor ID

1. Open Phoscon App or deCONZ web interface
2. Navigate to your sensors
3. Click on the temperature sensor
4. Note the sensor ID from the URL or sensor details

### Getting deCONZ API Key

1. Open Phoscon App
2. Go to Settings → Gateway → Advanced
3. Copy the API key (or create a new one if needed)

## Development

### Prerequisites

- Node.js >= 22.0.0
- npm

### Setup

1. Clone the repository:

    ```bash
    git clone https://github.com/lucavb/homebridge-deconz-shelly-thermostat.git
    cd homebridge-deconz-shelly-thermostat
    ```

2. Install dependencies:

    ```bash
    npm install
    ```

3. Build the project:
    ```bash
    npm run build
    ```

### Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm run dev` - Watch mode for development
- `npm test` - Run tests with Vitest
- `npm run test:ui` - Run tests with UI
- `npm run test:coverage` - Run tests with coverage
- `npm run cq:lint` - Run ESLint
- `npm run cq:lint:fix` - Fix ESLint issues
- `npm run cq:format` - Format code with Prettier
- `npm run cq:format:check` - Check code formatting
- `npm run cq:type-check` - Type check without building
- `npm run clean` - Remove build artifacts

### Code Quality

The project uses:

- **ESLint 9** with flat config for linting
- **Prettier** for code formatting
- **TypeScript** for type safety
- **Vitest** for testing
- **RxJS** for reactive programming

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. When contributing:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Ensure tests pass (`npm test`)
5. Run code quality checks (`npm run cq`)
6. Submit a pull request

## License

ISC

## Author

**Luca Becker**

- Website: [luca-becker.me](https://luca-becker.me)
- Email: hello@luca-becker.me

## Related Projects

- [homebridge-deconz](https://www.npmjs.com/package/homebridge-deconz) - Official deCONZ plugin for Homebridge
- [homebridge-shelly](https://www.npmjs.com/package/homebridge-shelly) - Shelly plugin for Homebridge

## Support

For issues, feature requests, or questions:

- [GitHub Issues](https://github.com/lucavb/homebridge-deconz-shelly-thermostat/issues)
