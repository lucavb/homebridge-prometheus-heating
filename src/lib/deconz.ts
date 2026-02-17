import { Observable, from } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { deconzSensorInfoSchema } from '../interfaces/deconz';

const globalFetch = fetch;

export class DeconzClient {
    constructor(
        private readonly host: string,
        private readonly username: string,
        private readonly id: number,
        private readonly fetch = globalFetch,
    ) {}

    public getTemperature(): Observable<number> {
        return from(
            this.fetch(`http://${this.host}/api/${this.username}/sensors/${this.id}`).catch((error) => {
                throw new Error(
                    `Failed to fetch deCONZ sensor data from ${this.host}: ${error instanceof Error ? error.message : String(error)}`,
                );
            }),
        ).pipe(
            switchMap((response: Response) => {
                if (!response.ok) {
                    throw new Error(`deCONZ API returned status ${response.status}: ${response.statusText}`);
                }
                return from(response.json());
            }),
            map((body: unknown) => {
                try {
                    return deconzSensorInfoSchema.parse(body);
                } catch (error) {
                    throw new Error(
                        `Invalid deCONZ sensor response format: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            }),
            map((info) => info.state.temperature / 100),
        );
    }
}
