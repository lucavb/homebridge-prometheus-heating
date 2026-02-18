/**
 * Minimal dependency interfaces for testability. Production code uses
 * default adapters bound to Node globals; tests inject fakes.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Mode, ObjectEncodingOptions, OpenMode } from 'node:fs';
import { Abortable } from 'node:events';

export interface HttpClientResponse {
    json(): Promise<unknown>;
    ok: boolean;
    status: number;
}

export interface HttpClient {
    fetch: (url: string, options: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;
}

export interface Clock {
    now(): number;
}

export type TimeoutId = ReturnType<typeof setTimeout>;
export type IntervalId = ReturnType<typeof setInterval>;

export interface TimeoutScheduler {
    setTimeout(callback: () => void, ms: number): TimeoutId;
    clearTimeout(id: TimeoutId): void;
}

export interface IntervalScheduler {
    setInterval: (callback: () => void, ms: number) => IntervalId;
    clearInterval: (id: IntervalId) => void;
}

export interface AbortControllerFactory {
    create(): AbortController;
}

export interface FsAdapter {
    mkdir: typeof mkdir;
    readFile: (
        path: string,
        options: ({ encoding: BufferEncoding; flag?: OpenMode | undefined } & Abortable) | BufferEncoding,
    ) => Promise<string>;
    writeFile: (
        file: string,
        data: string,
        options?:
            | (ObjectEncodingOptions & {
                  flag?: OpenMode | undefined;
                  flush?: boolean | undefined;
                  mode?: Mode | undefined;
              } & Abortable)
            | BufferEncoding
            | null,
    ) => Promise<void>;
}

export interface PathAdapter {
    join(...paths: string[]): string;
}

export interface JsonAdapter {
    parse<T>(text: string): T;
    stringify(value: unknown, replacer?: unknown, space?: number): string;
}

// --- Production defaults (Node globals) ---

export const defaultHttpClient = {
    fetch,
} as const satisfies HttpClient;

export const defaultClock = {
    now: Date.now,
} as const satisfies Clock;

export const defaultTimeoutScheduler = {
    clearTimeout,
    setTimeout,
} as const satisfies TimeoutScheduler;

export const defaultIntervalScheduler = {
    clearInterval,
    setInterval,
} as const satisfies IntervalScheduler;

export const defaultAbortControllerFactory = {
    create: () => new AbortController(),
} as const satisfies AbortControllerFactory;

export const defaultFsAdapter = {
    mkdir,
    readFile,
    writeFile,
} as const satisfies FsAdapter;

export const defaultPathAdapter = {
    join,
} as const satisfies PathAdapter;

export const defaultJsonAdapter = {
    parse: <T>(text: string): T => JSON.parse(text) as T,
    stringify: (value, replacer, space) => JSON.stringify(value, replacer as undefined, space),
} as const satisfies JsonAdapter;
