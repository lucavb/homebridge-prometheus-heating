import { API, Logging, PlatformAccessory } from 'homebridge';
import { CharacteristicValue } from 'hap-nodejs';
import { AccessoryConfig } from '../interfaces/config';
import { BehaviorSubject, combineLatest, EMPTY, firstValueFrom, of, Subject, timer } from 'rxjs';
import { DeconzClient } from './deconz';
import { ThermostatState } from '../interfaces/homekit';
import { ShellyClient } from './shelly';
import { catchError, map, switchMap, take, takeUntil, tap, timeout } from 'rxjs/operators';

type HAP = API['hap'];

export class HeatingAccessory {
    private readonly deconzClient?: DeconzClient;
    private readonly shelly?: ShellyClient;
    private readonly terminate: Subject<void> = new Subject<void>();
    private isDestroyed = false;

    private readonly Service: HAP['Service'];
    private readonly Characteristic: HAP['Characteristic'];

    private thermostat!: ReturnType<PlatformAccessory['getService']>;

    private readonly CurrentHeatingCoolingStateInstance: HAP['Characteristic']['CurrentHeatingCoolingState'];
    private readonly TargetHeatingCoolingStateInstance: HAP['Characteristic']['TargetHeatingCoolingState'];
    private readonly pluginOffStates: Set<number>;
    private readonly temperatureWindow: number;
    private readonly pollingInterval: number;

    private readonly homekitState = new BehaviorSubject({
        current: 0,
        target: 0,
        targetTemperature: 20,
    } satisfies ThermostatState);

    constructor(
        private readonly logger: Logging,
        private readonly config: AccessoryConfig,
        private readonly accessory: PlatformAccessory,
        private readonly api: API,
    ) {
        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;
        this.CurrentHeatingCoolingStateInstance = this.api.hap.Characteristic.CurrentHeatingCoolingState;
        this.TargetHeatingCoolingStateInstance = this.api.hap.Characteristic.TargetHeatingCoolingState;
        this.pluginOffStates = new Set<number>([
            this.TargetHeatingCoolingStateInstance.OFF,
            this.TargetHeatingCoolingStateInstance.COOL,
        ]);
        this.temperatureWindow = this.config.temperatureWindow ?? 0.5;
        this.pollingInterval = this.config.pollingInterval ?? 120000;

        this.setupServices();

        if (!this.config.deconz || !this.config.shelly) {
            logger.error('need both deconz and shelly key');
            return;
        }

        this.api.on('shutdown', () => this.destroy());

        const { host: deconzHost, id: deconzId, user: deconzUsername } = this.config.deconz;
        this.deconzClient = new DeconzClient(deconzHost, deconzUsername, deconzId, fetch);
        const { host: shellyHost, relay } = this.config.shelly;
        this.shelly = new ShellyClient(shellyHost, relay, fetch);
        this.shelly
            .getState()
            .pipe(
                take(1),
                tap((heating: boolean) => {
                    const target = heating
                        ? this.TargetHeatingCoolingStateInstance.HEAT
                        : this.TargetHeatingCoolingStateInstance.OFF;
                    this.homekitState.next({
                        ...this.homekitState.getValue(),
                        target,
                    });
                }),
                takeUntil(this.terminate),
            )
            .subscribe();
        this.setupPipe();
    }

    public destroy(): void {
        if (this.isDestroyed) {
            return;
        }
        this.isDestroyed = true;

        this.logger.debug('Destroying accessory:', this.config.name);
        this.terminate.next();
        this.terminate.complete();
        this.homekitState.complete();
    }

    private setupPipe(): void {
        combineLatest([this.homekitState, timer(0, this.pollingInterval)])
            .pipe(
                map(([state]: [ThermostatState, number]) => state),
                switchMap((state: ThermostatState) => {
                    if (this.pluginOffStates.has(state.target)) {
                        return this.shelly?.setState(false).pipe(switchMap(() => EMPTY)) ?? EMPTY;
                    } else {
                        return of(state);
                    }
                }),
                switchMap((state: ThermostatState) =>
                    combineLatest([
                        this.deconzClient?.getTemperature() ?? EMPTY,
                        this.shelly?.getState() ?? EMPTY,
                        of(state),
                    ]),
                ),
                tap(([temperature]: [number, boolean, ThermostatState]) => {
                    const characteristic = this.thermostat?.getCharacteristic(this.Characteristic.CurrentTemperature);
                    if (characteristic) {
                        characteristic.setValue(temperature);
                    }
                }),
                switchMap(([temperature, heating, { targetTemperature }]: [number, boolean, ThermostatState]) => {
                    const temperatureDifference = targetTemperature - temperature;
                    const shouldHeat = temperatureDifference > this.temperatureWindow;
                    this.logger.info('Internal status update', {
                        temperatureWindow: this.temperatureWindow,
                        heating,
                        shouldHeat,
                        targetTemperature,
                        temperature,
                        temperatureDifference,
                    });
                    return shouldHeat !== heating ? (this.shelly?.setState(shouldHeat) ?? EMPTY) : EMPTY;
                }),
                tap((heating: boolean) => {
                    const characteristic = this.thermostat?.getCharacteristic(
                        this.Characteristic.CurrentHeatingCoolingState,
                    );
                    if (characteristic) {
                        characteristic.setValue(
                            heating
                                ? this.CurrentHeatingCoolingStateInstance.HEAT
                                : this.CurrentHeatingCoolingStateInstance.OFF,
                        );
                    }
                }),
                catchError((error, caught) => {
                    this.logger.error('Failed to update thermostat state:', {
                        accessory: this.config.name,
                        error: error instanceof Error ? error.message : String(error),
                        stack: error instanceof Error ? error.stack : undefined,
                    });
                    return timer(5000).pipe(switchMap(() => caught));
                }),
                takeUntil(this.terminate),
            )
            .subscribe();
    }

    private setupServices(): void {
        this.thermostat =
            this.accessory.getService(this.Service.Thermostat) ||
            this.accessory.addService(this.Service.Thermostat, this.config.name);

        if (!this.thermostat) {
            this.logger.error('Failed to create thermostat service');
            return;
        }

        const currentHeatingCoolingState = this.thermostat.getCharacteristic(
            this.Characteristic.CurrentHeatingCoolingState,
        );
        if (currentHeatingCoolingState) {
            currentHeatingCoolingState.onGet(() => {
                return this.homekitState.getValue().current;
            });
        }

        const targetHeatingCoolingState = this.thermostat.getCharacteristic(
            this.Characteristic.TargetHeatingCoolingState,
        );
        if (targetHeatingCoolingState) {
            targetHeatingCoolingState.onGet(() => {
                return this.homekitState.getValue().target;
            });
            targetHeatingCoolingState.onSet((value: CharacteristicValue) => {
                if (typeof value === 'number') {
                    this.homekitState.next({
                        ...this.homekitState.getValue(),
                        target: value,
                    });
                }
            });
        }

        const currentTemperature = this.thermostat.getCharacteristic(this.Characteristic.CurrentTemperature);
        if (currentTemperature) {
            currentTemperature.onGet(async () => {
                if (!this.deconzClient) {
                    this.logger.error('deconz client could not be setup');
                    throw new Error('deconz client could not be setup');
                }
                return firstValueFrom(
                    this.deconzClient.getTemperature().pipe(timeout(10 * 1000), takeUntil(this.terminate)),
                );
            });
        }

        const targetTemperature = this.thermostat.getCharacteristic(this.Characteristic.TargetTemperature);
        if (targetTemperature) {
            targetTemperature.onGet(() => {
                return this.homekitState.getValue().targetTemperature;
            });
            targetTemperature.onSet((value: CharacteristicValue) => {
                if (typeof value === 'number') {
                    this.homekitState.next({
                        ...this.homekitState.getValue(),
                        targetTemperature: value,
                    });
                }
            });
        }
    }
}
