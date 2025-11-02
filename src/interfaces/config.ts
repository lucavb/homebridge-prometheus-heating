import { PlatformConfig } from 'homebridge';
import { z } from 'zod';

const deconzConfigSchema = z.object({
    host: z.string().min(1, 'deCONZ host is required'),
    id: z.number().int().positive('deCONZ sensor ID must be a positive integer'),
    user: z.string().min(1, 'deCONZ username is required'),
});

const shellyConfigSchema = z.object({
    host: z.string().min(1, 'Shelly host is required'),
    relay: z.union([z.literal(0), z.literal(1)]),
});

export const accessoryConfigSchema = z.object({
    name: z.string().min(1, 'Accessory name is required'),
    deconz: deconzConfigSchema,
    shelly: shellyConfigSchema,
    temperatureWindow: z.number().positive('Temperature window must be a positive number').optional().default(0.5),
});

export const homebridgeHeatingConfigSchema = z
    .object({
        accessories: z.array(accessoryConfigSchema).min(1, 'At least one accessory must be configured'),
    })
    .catchall(z.unknown());

export type AccessoryConfig = z.infer<typeof accessoryConfigSchema>;

export interface HomebridgeHeatingConfig extends Omit<PlatformConfig, 'platform'> {
    accessories: AccessoryConfig[];
}

export function validateConfig(config: unknown) {
    const result = homebridgeHeatingConfigSchema.safeParse(config);
    if (!result.success) {
        const errors = result.error.issues
            .map((issue) => {
                const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
                return `${path}${issue.message}`;
            })
            .join(', ');
        throw new Error(`Invalid configuration: ${errors}`);
    }
    if (typeof config !== 'object' || config === null) {
        throw new Error('Configuration must be an object');
    }
    return {
        ...config,
        ...result.data,
    } as const satisfies HomebridgeHeatingConfig;
}
