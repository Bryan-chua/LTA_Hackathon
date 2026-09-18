import { CommuteApp } from "@/components/commute-app";
import { journeyOrchestrator } from "@/lib/application/journey-orchestrator";
import { demandDemoEnabled, demandStore } from "@/lib/application/demand-store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const initialPlan = await journeyOrchestrator.plan({ scenarioId: "ewl-disruption",
    demand: demandDemoEnabled() ? { profile: "typical", selections: demandStore.selections("ewl-disruption", "typical") } : undefined });
  return <CommuteApp initialPlan={initialPlan} />;
}
