import type { Routine } from "../domain";
import { scenarios } from "../fixtures";
import { readSetting, writeSetting } from "./device-database";

const KEY = "routine-v1";

export const defaultRoutine = (): Routine => ({
  ...structuredClone(scenarios.normal.routine),
  timezone: "Asia/Singapore",
  materialDelayMinutes: 10,
});

export async function loadRoutine(): Promise<Routine> {
  return (await readSetting<Routine>(KEY)) ?? defaultRoutine();
}

export async function saveRoutine(routine: Routine): Promise<void> {
  await writeSetting(KEY, routine);
}

export async function resetRoutine(): Promise<Routine> {
  const routine = defaultRoutine();
  await saveRoutine(routine);
  return routine;
}
