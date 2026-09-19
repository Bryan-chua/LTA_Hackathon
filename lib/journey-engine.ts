import type { Alternative, Journey, TravelCondition } from "./domain";
import { scoreJourneyCandidates, type JourneyScoreWeights } from "./journey-scoring";
export { findAffectedSegments, isLegAffected } from "./condition-matching";

export function buildAlternatives(
  usual: Journey,
  recommended: Journey | Journey[] | undefined,
  deadline: string,
  conditions: TravelCondition[],
  weights?: JourneyScoreWeights,
): Alternative[] {
  return scoreJourneyCandidates(usual, recommended, deadline, conditions, weights);
}
