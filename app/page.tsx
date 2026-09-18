import { CommuteApp } from "@/components/commute-app";
import { journeyOrchestrator } from "@/lib/application/journey-orchestrator";

export default async function Home() {
  const initialPlan = await journeyOrchestrator.plan({ scenarioId: "ewl-disruption" });
  return <CommuteApp initialPlan={initialPlan} />;
}
