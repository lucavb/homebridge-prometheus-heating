import { z } from 'zod';

export type DateString = string;

const configSchema = z.object({
    battery: z.number(),
    offset: z.number(),
    on: z.boolean(),
    reachable: z.boolean(),
});

const stateSchema = z.object({
    lastupdated: z.union([z.string(), z.date()]).transform((val) => (val instanceof Date ? val : new Date(val))),
    temperature: z.number(),
});

export const deconzSensorInfoSchema = z.object({
    config: configSchema,
    ep: z.number(),
    etag: z.string(),
    lastseen: z.string(),
    manufacturername: z.string(),
    modelid: z.string(),
    name: z.string(),
    state: stateSchema,
    swversion: z.string(),
    type: z.string(),
    uniqueid: z.string(),
});

export type Config = z.infer<typeof configSchema>;
export type State = z.infer<typeof stateSchema>;
export type DeconzSensorInfo = z.infer<typeof deconzSensorInfoSchema>;
