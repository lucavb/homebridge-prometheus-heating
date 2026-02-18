# homebridge-prometheus-heating

Homebridge platform that exposes **one Thermostat per room**, reads room temperatures from **Prometheus**, and controls heating via **Shelly** relays using hysteresis (corridor) control by default, with optional PWM.

## Requirements

- Node.js >= 24
- Homebridge >= 1.8.0
- A Prometheus server exposing temperature metrics
- Shelly relay devices (Gen1 or Gen2/Gen3) for each room

## Installation

```bash
npm install -g homebridge-prometheus-heating
```

Add the platform in your Homebridge config (or use the Homebridge UI):

```json
{
    "platforms": [
        {
            "platform": "PrometheusHeatingPlatform",
            "name": "Prometheus Heating",
            "prometheus": {
                "baseUrl": "http://prometheus:9090"
            },
            "rooms": [
                {
                    "id": "living",
                    "displayName": "Living Room",
                    "promQuery": "room_temperature_celsius{room=\"living\"}",
                    "shelly": { "host": "192.168.1.10", "generation": "auto" }
                }
            ]
        }
    ]
}
```

## Configuration (camelCase)

| Field                                      | Required | Description                                        |
| ------------------------------------------ | -------- | -------------------------------------------------- |
| `name`                                     | Yes      | Platform display name                              |
| `prometheus.baseUrl`                       | Yes      | Prometheus base URL                                |
| `prometheus.queryTimeoutMs`                | No       | Query timeout in ms (default `5000`)               |
| `prometheus.auth.mode`                     | No       | `none` or `bearer`; if `bearer`, set `bearerToken` |
| `control.controlMode`                      | No       | `hysteresis` (default) or `pwm`                    |
| `control.pollIntervalMs`                   | No       | Poll interval in ms (default `30000`)              |
| `control.hysteresisC`                      | No       | Corridor half-width in °C (default `0.5`)          |
| `control.minOnMs` / `control.minOffMs`     | No       | Min on/off time in ms (default `600000`)           |
| `rooms`                                    | Yes      | Array of room configs                              |
| `logging.debug` / `logging.logPromQueries` | No       | Optional logging flags                             |

Each **room** must have: `id`, `displayName`, `promQuery`, `shelly.host`. Optional: `shelly.generation` (`auto` / `gen1` / `gen23`), `shelly.switchId`, `targetTemperatureC`, `minTargetTemperatureC`, `maxTargetTemperatureC`, and `override` (e.g. `pollIntervalMs`, `minOnMs`, `minOffMs`, `deadbandC`).

## PromQL examples

- `room_temperature_celsius{room="living"}`
- `last_over_time(temperature_celsius[5m])`
- `temp_sensor_celsius{job="room-sensors", room="bedroom"}`

Your query should return one sample. Stale data (older than `control.staleAfterMs`) turns heating off.

## Shelly Gen1 vs Gen2/Gen3

- **Gen1**: `/status` and `/relay/{id}?turn=on|off`. Set `shelly.generation` to `gen1` if auto-detect fails.
- **Gen2/Gen3**: JSON-RPC at `/rpc` (`Switch.Set`, `Switch.GetStatus`). Use `gen23` to force.

Manual relay toggles are re-asserted by the plugin on the next poll.

## Control behaviour

- **Hysteresis (default)**: Heat on when temp < target − hysteresis; off when temp ≥ target + hysteresis. Min on/off times avoid short cycling.
- **PWM (optional)**: Time-proportional output over a configurable cycle; respects min on/off.
- **Safety**: Stale or invalid temperature turns heating off. On startup, relay defaults to off until a valid sample is received.
- **Immediate user response**: When a user changes the target temperature (e.g. via HomeKit), a full control evaluation runs immediately — bypassing `minOnMs` and `minOffMs` for that single evaluation. Subsequent periodic ticks resume normal min-cycle enforcement. This means the relay can switch sooner than the configured minimum on/off times when the user explicitly changes the setpoint; set `minOnMs`/`minOffMs` accordingly if relay wear is a concern.

## Development

```bash
npm install
npm run build
npm run typecheck
npm run lint
npm run format:check
```

## License

GPL-3.0-or-later
