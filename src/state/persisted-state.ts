import type { Clock, FsAdapter, JsonAdapter, PathAdapter } from '../runtime/dependencies.ts';
import { defaultClock, defaultFsAdapter, defaultJsonAdapter, defaultPathAdapter } from '../runtime/dependencies.ts';

const STATE_FILE = 'prometheus-heating-state.json';

export interface RoomPersistedState {
    relayOn: boolean;
    lastUpdatedMs: number;
}

export interface PersistedState {
    rooms: Record<string, RoomPersistedState>;
}

export interface PersistedStateDeps {
    fs: FsAdapter;
    path: PathAdapter;
    json: JsonAdapter;
    clock: Clock;
}

const DEFAULT_STATE: PersistedState = { rooms: {} };

export async function loadPersistedState(
    persistDir: string,
    deps?: Partial<PersistedStateDeps>,
): Promise<PersistedState> {
    const fs = deps?.fs ?? defaultFsAdapter;
    const pathAdapter = deps?.path ?? defaultPathAdapter;
    const json = deps?.json ?? defaultJsonAdapter;
    const path = pathAdapter.join(persistDir, STATE_FILE);
    try {
        const raw = await fs.readFile(path, 'utf-8');
        const parsed = json.parse(raw) as unknown;
        if (
            parsed !== null &&
            typeof parsed === 'object' &&
            'rooms' in parsed &&
            typeof (parsed as PersistedState).rooms === 'object'
        ) {
            return parsed as PersistedState;
        }
    } catch {
        // file missing or invalid
    }
    return { ...DEFAULT_STATE };
}

export async function savePersistedState(
    persistDir: string,
    state: PersistedState,
    deps?: Partial<PersistedStateDeps>,
): Promise<void> {
    const fs = deps?.fs ?? defaultFsAdapter;
    const pathAdapter = deps?.path ?? defaultPathAdapter;
    const json = deps?.json ?? defaultJsonAdapter;
    await fs.mkdir(persistDir, { recursive: true });
    const path = pathAdapter.join(persistDir, STATE_FILE);
    await fs.writeFile(path, json.stringify(state, null, 2), 'utf-8');
}

export function updateRoomState(
    state: PersistedState,
    roomId: string,
    relayOn: boolean,
    deps?: Partial<Pick<PersistedStateDeps, 'clock'>>,
): PersistedState {
    const clock = deps?.clock ?? defaultClock;
    return {
        ...state,
        rooms: {
            ...state.rooms,
            [roomId]: { relayOn, lastUpdatedMs: clock.now() },
        },
    };
}
