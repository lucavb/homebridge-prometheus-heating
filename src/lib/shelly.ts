import { defer, from, Observable } from 'rxjs';
import { map, retry, switchMap } from 'rxjs/operators';
import { shellyRelayResponseSchema } from '../interfaces/shelly';

const globalFetch = fetch;

export class ShellyClient {
    constructor(
        private readonly host: string,
        private readonly relay: 0 | 1,
        private readonly fetch = globalFetch,
    ) {}

    public getState(): Observable<boolean> {
        return defer(() =>
            from(
                this.fetch(`http://${this.host}/relay/${this.relay}`).catch((error) => {
                    throw new Error(
                        `Failed to fetch Shelly relay state from ${this.host}: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }),
            ),
        ).pipe(
            retry({ count: 10, delay: 1000 }),
            switchMap((response) => {
                if (!response.ok) {
                    throw new Error(`Shelly API returned status ${response.status}: ${response.statusText}`);
                }
                return from(response.json());
            }),
            map((body: unknown) => {
                try {
                    return shellyRelayResponseSchema.parse(body);
                } catch (error) {
                    throw new Error(
                        `Invalid Shelly relay response format: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            }),
            map((response) => response.ison),
        );
    }

    public setState(state: boolean): Observable<boolean> {
        const turn = state ? 'on' : 'off';
        return defer(() =>
            from(
                this.fetch(`http://${this.host}/relay/${this.relay}?turn=${turn}`).catch((error) => {
                    throw new Error(
                        `Failed to set Shelly relay state on ${this.host}: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }),
            ),
        ).pipe(
            retry({ count: 10, delay: 1000 }),
            switchMap((response) => {
                if (!response.ok) {
                    throw new Error(`Shelly API returned status ${response.status}: ${response.statusText}`);
                }
                return from(response.json());
            }),
            map((body: unknown) => {
                try {
                    return shellyRelayResponseSchema.parse(body);
                } catch (error) {
                    throw new Error(
                        `Invalid Shelly relay response format: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            }),
            map((response) => response.ison),
        );
    }
}
