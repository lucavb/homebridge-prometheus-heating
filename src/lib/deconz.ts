import { Observable, Subject, timer, from } from 'rxjs';
import { map, switchMap, takeUntil, tap } from 'rxjs/operators';
import { DeconzSensorInfo, deconzSensorInfoSchema } from '../interfaces/deconz';

const globalFetch = fetch;

export class DeconzClient {
    private readonly terminate = new Subject<void>();
    private readonly state = new Subject<DeconzSensorInfo>();

    constructor(
        private readonly host: string,
        private readonly username: string,
        private readonly id: number,
        private readonly fetch = globalFetch,
    ) {}

    public startInterval(intervalVal: number): void {
        timer(0, intervalVal)
            .pipe(
                tap(() => this.update()),
                takeUntil(this.terminate),
            )
            .subscribe();
    }

    public stopInterval(): void {
        this.terminate.next();
    }

    public getTemperature(): Observable<number> {
        this.update();
        return this.state.pipe(
            map((state: DeconzSensorInfo) => state.state.temperature),
            map((temperature: number) => temperature / 100),
        );
    }

    public update(): void {
        from(this.fetch(`http://${this.host}/api/${this.username}/sensors/${this.id}`))
            .pipe(
                switchMap((response: Response) => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    return from(response.json());
                }),
                map((body: unknown) => deconzSensorInfoSchema.parse(body)),
                tap((response) => this.state.next(response)),
                takeUntil(this.terminate),
            )
            .subscribe();
    }
}
