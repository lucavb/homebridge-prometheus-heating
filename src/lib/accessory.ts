import { API, Logging, PlatformAccessory } from 'homebridge';
import { CharacteristicValue } from 'hap-nodejs';
import { AccessoryConfig } from '../interfaces/config';
import { BehaviorSubject, combineLatest, EMPTY, of, Subject, timer } from 'rxjs';
import { DeconzClient } from './deconz';
import { ThermostatState } from '../interfaces/homekit';
import { ShellyClient } from './shelly';
import { catchError, map, switchMap, take, takeUntil, tap, timeout } from 'rxjs/operators';

type HAP = API['hap'];

export class HeatingAccessory {
    private readonly deconzClient?: DeconzClient;
    private readonly shelly?: ShellyClient;
    private readonly terminate: Subject<void> = new Subject<void>();

    private readonly Service: HAP['Service'];
    private readonly Characteristic: HAP['Characteristic'];

    private thermostat!: ReturnType<PlatformAccessory['getService']>;

    private readonly CurrentHeatingCoolingStateInstance: HAP['Characteristic']['CurrentHeatingCoolingState'];
    private readonly TargetHeatingCoolingStateInstance: HAP['Characteristic']['TargetHeatingCoolingState'];
    private readonly pluginOffStates: Set<number>;
    private readonly temperatureWindow: number;

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

        this.setupServices();

        if (!this.config.deconz || !this.config.shelly) {
            logger.error('need both deconz and shelly key');
            return;
        }

        this.api.on('shutdown', () => this.terminate.next());

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

    private setupPipe(): void {
        combineLatest([this.homekitState, timer(0, 2 * 60 * 1000)])
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
                catchError(() => {
                    this.logger.error('could not trigger an update');
                    return EMPTY;
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
            currentHeatingCoolingState.on('get', (callback) => {
                callback(null, this.homekitState.getValue().current);
            });
        }

        const targetHeatingCoolingState = this.thermostat.getCharacteristic(
            this.Characteristic.TargetHeatingCoolingState,
        );
        if (targetHeatingCoolingState) {
            targetHeatingCoolingState.on('get', (callback) => {
                callback(null, this.homekitState.getValue().target);
            });
            targetHeatingCoolingState.on('set', (value: CharacteristicValue, callback) => {
                if (typeof value === 'number') {
                    this.homekitState.next({
                        ...this.homekitState.getValue(),
                        target: value,
                    });
                }
                callback();
            });
        }

        const currentTemperature = this.thermostat.getCharacteristic(this.Characteristic.CurrentTemperature);
        if (currentTemperature) {
            currentTemperature.on('get', (callback) => {
                if (this.deconzClient) {
                    this.deconzClient
                        .getTemperature()
                        .pipe(
                            take(1),
                            timeout(10 * 1000),
                            tap((val: number) => callback(null, val)),
                            catchError((err) => {
                                callback(err);
                                return of(null);
                            }),
                            takeUntil(this.terminate),
                        )
                        .subscribe();
                } else {
                    this.logger.error('deconz client could not be setup?');
                    callback(new Error('deconz client could not be setup?'));
                }
            });
        }

        const targetTemperature = this.thermostat.getCharacteristic(this.Characteristic.TargetTemperature);
        if (targetTemperature) {
            targetTemperature.on('get', (callback) => {
                callback(null, this.homekitState.getValue().targetTemperature);
            });
            targetTemperature.on('set', (value: CharacteristicValue, callback) => {
                if (typeof value === 'number') {
                    this.homekitState.next({
                        ...this.homekitState.getValue(),
                        targetTemperature: value,
                    });
                }
                callback();
            });
        }
    }
}
