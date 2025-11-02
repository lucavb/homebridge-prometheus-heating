import { z } from 'zod';

export const shellyRelayResponseSchema = z.object({
    has_timer: z.boolean(),
    is_valid: z.boolean(),
    ison: z.boolean(),
    overpower: z.boolean(),
    overtemperature: z.boolean(),
    source: z.string(),
    timer_duration: z.number(),
    timer_remaining: z.number(),
    timer_started: z.number(),
});

export type ShellyRelayResponse = z.infer<typeof shellyRelayResponseSchema>;
