import { from, Observable } from 'rxjs';
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
        return from(this.fetch(`http://${this.host}/relay/${this.relay}`)).pipe(
            retry({ count: 10, delay: 1000 }),
            switchMap((response) => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return from(response.json());
            }),
            map((body: unknown) => shellyRelayResponseSchema.parse(body)),
            map((response) => response.ison),
        );
    }

    public setState(state: boolean): Observable<boolean> {
        const turn = state ? 'on' : 'off';
        return from(this.fetch(`http://${this.host}/relay/${this.relay}?turn=${turn}`)).pipe(
            retry({ count: 10, delay: 1000 }),
            switchMap((response) => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return from(response.json());
            }),
            map((body: unknown) => shellyRelayResponseSchema.parse(body)),
            map((response) => response.ison),
        );
    }
}
