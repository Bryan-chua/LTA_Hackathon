import { CommuteApp } from "@/components/commute-app";
import { journeyOrchestrator } from "@/lib/application/journey-orchestrator";
import { demandDemoEnabled, demandStore } from "@/lib/application/demand-store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const initialPlan = await journeyOrchestrator.plan({ scenarioId: "normal",
    demand: demandDemoEnabled() ? { profile: "typical", selections: demandStore.selections("normal", "typical") } : undefined });
  return <CommuteApp initialPlan={initialPlan} />;
}
