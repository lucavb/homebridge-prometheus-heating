import { z } from 'zod';

const authSchema = z
    .object({
        bearerToken: z.string().min(1).optional(),
        mode: z.enum(['none', 'bearer']).default('none'),
    })
    .superRefine((value, ctx) => {
        if (value.mode === 'bearer' && !value.bearerToken) {
            ctx.addIssue({
                code: 'custom',
                message: 'bearerToken is required when auth.mode is bearer',
                path: ['bearerToken'],
            });
        }
    });

const prometheusSchema = z.object({
    baseUrl: z.url(),
    queryTimeoutMs: z.number().int().min(500).max(60_000).default(5000),
    allowInsecureTls: z.boolean().default(false),
    auth: authSchema.default({ mode: 'none' }),
});

const shellySchema = z.object({
    generation: z.enum(['auto', 'gen1', 'gen23']).default('auto'),
    host: z.string().min(1),
    password: z.string().optional(),
    requestTimeoutMs: z.number().int().min(500).max(60_000).default(5000),
    switchId: z.number().int().min(0).max(8).default(0),
    username: z.string().optional(),
});

const roomOverrideSchema = z.object({
    deadbandC: z.number().min(0).max(2).optional(),
    minOffMs: z.number().int().min(1000).max(1_800_000).optional(),
    minOnMs: z.number().int().min(1000).max(1_800_000).optional(),
    pollIntervalMs: z.number().int().min(5000).max(300_000).optional(),
    pwmCycleMs: z.number().int().min(30_000).max(1_800_000).optional(),
});

const roomSchema = z
    .object({
        displayName: z.string().min(1),
        enabled: z.boolean().default(true),
        id: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,31}$/),
        maxTargetTemperatureC: z.number().min(5).max(35).default(24),
        minTargetTemperatureC: z.number().min(5).max(35).default(16),
        override: roomOverrideSchema.optional(),
        promQuery: z.string().min(1),
        shelly: shellySchema,
        targetTemperatureC: z.number().min(5).max(35).default(21),
    })
    .superRefine((value, ctx) => {
        if (value.minTargetTemperatureC > value.maxTargetTemperatureC) {
            ctx.addIssue({
                code: 'custom',
                message: 'minTargetTemperatureC must be <= maxTargetTemperatureC',
                path: ['minTargetTemperatureC'],
            });
        }
    });

const controlSchema = z.object({
    controlMode: z.enum(['hysteresis', 'pwm']).default('hysteresis'),
    pollIntervalMs: z.number().int().min(5000).max(300_000).default(30_000),
    targetTemperatureC: z.number().min(5).max(35).default(21),
    hysteresisC: z.number().min(0).max(2).default(0.5),
    minOnMs: z.number().int().min(1000).max(1_800_000).default(600_000),
    minOffMs: z.number().int().min(1000).max(1_800_000).default(600_000),
    pwmCycleMs: z.number().int().min(30_000).max(1_800_000).default(300_000),
    staleAfterMs: z.number().int().min(10_000).max(3_600_000).default(180_000),
    minTemperatureC: z.number().default(-20),
    maxTemperatureC: z.number().default(60),
});

const loggingSchema = z.object({
    debug: z.boolean().default(false),
    logPromQueries: z.boolean().default(false),
});

export const pluginConfigSchema = z.object({
    name: z.string().min(2).default('Prometheus Heating'),
    prometheus: prometheusSchema,
    control: z.optional(controlSchema).default(controlSchema.parse({})),
    rooms: z.array(roomSchema).min(1),
    logging: z.optional(loggingSchema).default(loggingSchema.parse({})),
});

export type PluginConfig = z.infer<typeof pluginConfigSchema>;
export type RoomConfig = z.infer<typeof roomSchema>;
export type ControlConfig = z.infer<typeof controlSchema>;
export type ShellyConfig = z.infer<typeof shellySchema>;
export type PrometheusConfig = z.infer<typeof prometheusSchema>;
