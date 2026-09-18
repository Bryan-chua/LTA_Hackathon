import { z } from "zod";

const coordinateSchema = z.object({
  lat: z.number().min(1.1).max(1.5),
  lng: z.number().min(103.5).max(104.1),
});
const placeSchema = z.object({
  name: z.string().min(1).max(200),
  shortName: z.string().min(1).max(80),
  coordinate: coordinateSchema,
});
const clockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const routineSchema = z.object({
  id: z.string().min(1).max(100),
  travellerName: z.string().min(1).max(80),
  origin: placeSchema,
  destination: placeSchema,
  departureTime: clockSchema,
  arrivalDeadline: clockSchema,
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  enabled: z.boolean(),
  timezone: z.literal("Asia/Singapore").default("Asia/Singapore"),
  materialDelayMinutes: z.number().int().min(5).max(60).default(10),
}).superRefine((routine, context) => {
  if (routine.origin.coordinate.lat === routine.destination.coordinate.lat &&
      routine.origin.coordinate.lng === routine.destination.coordinate.lng) {
    context.addIssue({ code: "custom", message: "Origin and destination must be different.", path: ["destination"] });
  }
  if (routine.arrivalDeadline <= routine.departureTime) {
    context.addIssue({ code: "custom", message: "Arrival deadline must be after departure.", path: ["arrivalDeadline"] });
  }
});

export type ValidRoutine = z.infer<typeof routineSchema>;
