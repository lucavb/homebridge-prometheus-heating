export interface ShellyDriver {
    setOn(on: boolean): Promise<void>;
    getOn(): Promise<boolean>;
}

export type ShellyGeneration = 'gen1' | 'gen23';
