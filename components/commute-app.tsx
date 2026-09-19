"use client";

import {
  Accessibility,
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  BusFront,
  Check,
  ChevronRight,
  Clock3,
  CloudOff,
  Footprints,
  GitCompareArrows,
  House,
  Info,
  Menu,
  Navigation,
  Radio,
  RefreshCw,
  ShieldCheck,
  TrainFront,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AffectedSegment, Alternative, BusArrivalInfo, BusLoadCode, CrowdingLevel, Journey, JourneyLeg, Scenario, TravelMode } from "@/lib/domain";
import { requestJourneyPlan, requestMorningCheck, requestParticipation } from "@/lib/application/journey-api-client";
import type { JourneyPlanView } from "@/lib/application/journey-view-model";
import { RouteMap } from "./route-map";
import { DemandPanel } from "./demand-panel";
import type { DemandProfile } from "@/lib/demand-flow";
import { RoutinePanel } from "./routine-panel";
import { ReliabilityPanel } from "./reliability-panel";
import { loadRoutine } from "@/lib/client/routine-store";
import {
  consumeLegacyActiveJourney,
  type CachedJourneySnapshot,
  loadLatestJourneySnapshot,
  saveJourneySnapshot,
  snapshotFreshness,
  updateSelectedJourney,
} from "@/lib/client/journey-store";

type Screen = "today" | "compare" | "journey";

const navItems: { id: Screen; label: string; icon: typeof House }[] = [
  { id: "today", label: "Today", icon: House },
  { id: "compare", label: "Compare", icon: GitCompareArrows },
  { id: "journey", label: "Journey", icon: Navigation },
];

const clockTime = (value: string) => value.includes("T") ? value.slice(11, 16) : value;

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <span />
      <i />
      <b />
    </div>
  );
}

function GovernmentBanner({ onAbout }: { onAbout: () => void }) {
  return (
    <div className="government-banner">
      <ShieldCheck size={13} aria-hidden="true" />
      <span>Hackathon concept · Unofficial commuter demo</span>
      <button type="button" onClick={onAbout} aria-label="About this concept"><Info size={13} /></button>
    </div>
  );
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="concept-dialog" role="dialog" aria-modal="true" aria-labelledby="concept-dialog-title">
        <span className="dialog-eyebrow">ABOUT THIS CONCEPT</span>
        <h2 id="concept-dialog-title">A proactive companion for Rachel&apos;s commute</h2>
        <p>Smart Commute checks a saved Tampines-to-Raffles Place routine and recommends a clear action only when conditions materially affect the trip.</p>
        <ul>
          <li><strong>Live and replay stay distinct.</strong> Provider freshness and labelled judging fixtures are never mixed silently.</li>
          <li><strong>Privacy is device-first.</strong> Address labels and saved journeys stay in IndexedDB unless Rachel explicitly enables alerts.</li>
          <li><strong>Reliability stays explainable.</strong> Replay can show a clearly labelled synthetic model; live journeys fall back to inspectable rules until a calibrated model is available. No LLM is used.</li>
        </ul>
        <button className="primary-button" type="button" onClick={onClose} autoFocus>Close</button>
      </section>
    </div>
  );
}

function Header({ scenario, travelMode, onMode, onTravelMode, onCompare, onProfile, isLoading }: {
  scenario: Scenario;
  travelMode: TravelMode;
  onMode: (mode: "live" | Scenario["id"]) => void;
  onTravelMode: (mode: TravelMode) => void;
  onCompare: () => void;
  onProfile: () => void;
  isLoading: boolean;
}) {
  const accessible = travelMode === "accessible";
  const primaryCondition = [...scenario.conditions].sort((left, right) =>
    ({ info: 0, minor: 1, major: 2 })[right.severity] - ({ info: 0, minor: 1, major: 2 })[left.severity])[0];
  return (
    <>
      <header className="brand-header">
        <div className="brand-lockup">
          <BrandMark />
          <div><strong>Smart Commute</strong><small>Hackathon concept</small></div>
        </div>
        <div className="header-actions">
          <button type="button" className="mode-toggle" aria-pressed={accessible} disabled={isLoading}
            aria-label={accessible ? "Accessible travel mode on. Switch to standard." : "Standard travel mode. Switch to accessible."}
            onClick={() => onTravelMode(accessible ? "standard" : "accessible")}>
            <Accessibility size={15} /><span aria-hidden="true">{accessible ? "Accessible" : "Standard"}</span>
          </button>
          <label className="scenario-picker">
            <span className="sr-only">Data scenario</span>
            <select aria-label="Data scenario" value={scenario.id} disabled={isLoading}
              onChange={(event) => onMode(event.target.value as Scenario["id"])}>
              <option value="normal">Normal replay</option>
              <option value="ewl-disruption">Unplanned disruption</option>
              <option value="ewl-planned-work">Planned work</option>
            </select>
          </label>
          <button className="scenario-button" onClick={() => onMode("live")} disabled={isLoading} aria-label="Run live morning check">
            <RefreshCw size={15} /><span>{isLoading ? "Loading" : "Live check"}</span>
          </button>
          <button className="avatar" type="button" onClick={onProfile} aria-label="Open Rachel's routine profile">R</button>
        </div>
      </header>
      {accessible && (
        <div className="accessible-mode-banner" role="status">
          <Accessibility size={15} aria-hidden="true" />
          <span>Accessible mode considers reported lift outages and wheelchair-accessible buses, and weights transfers and walking more heavily. Routes are not certified step-free.</span>
        </div>
      )}
      {primaryCondition && (
        <button type="button" className="advisory" onClick={onCompare} aria-label="Review disruption impact and route alternatives">
          <AlertTriangle size={18} aria-hidden="true" />
          <span className="advisory-copy"><strong>{primaryCondition.title}</strong><span>{scenario.isReplay ? "Replay" : "Live"} · Updated {scenario.updatedAt}</span></span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      )}
    </>
  );
}

function Arrival({ journey, deadline }: { journey: Journey; deadline: string }) {
  const late = journey.arrival.p50 > deadline;
  return (
    <div className="arrival-row">
      <div>
        <span>Expected arrival</span>
        <strong>{journey.arrival.p50}</strong>
        <small>{journey.arrival.earliest}–{journey.arrival.latest}</small>
      </div>
      <div className={`deadline-state ${late ? "deadline-state--late" : ""}`}>
        {late ? <AlertTriangle size={17} /> : <Check size={17} />}
        <div><strong>{late ? "After deadline" : "On time"}</strong><span>Deadline {deadline}</span></div>
      </div>
    </div>
  );
}

function ReliabilityForecast({ option }: { option: Alternative }) {
  const forecast = option.reliability;
  return (
    <section className="reliability-forecast" aria-label="Personalised Journey Reliability Forecast">
      <div className="reliability-heading">
        <div><span>PERSONALISED JOURNEY RELIABILITY</span><strong>
          {forecast.probabilityBeforeDeadline === undefined
            ? `Likely arrival ${forecast.likelyArrival.from}-${forecast.likelyArrival.to}`
            : `${Math.round(forecast.probabilityBeforeDeadline * 100)}% likely before deadline`}
        </strong></div>
        {forecast.synthetic && <small className="synthetic-model-label">Synthetic model output</small>}
      </div>
      <div className="reliability-times">
        <span>P50 <strong>{forecast.p50Arrival}</strong></span>
        {forecast.p90Arrival && <span>P90 <strong>{forecast.p90Arrival}</strong></span>}
        <span>Confidence <strong>{forecast.confidence}</strong></span>
        <span>Freshness <strong>{forecast.freshness}</strong></span>
      </div>
      {forecast.method === "deterministic_fallback" &&
        <p className="forecast-fallback">Cautious rule-based estimate - not calibrated.</p>}
      <ul className="reliability-reasons">
        {forecast.reasons.map((reason) => <li key={reason.code}>
          <span aria-hidden="true">{reason.direction === "helps" ? "+" : "-"}</span>{reason.label}
        </li>)}
      </ul>
    </section>
  );
}

function TodayScreen({ plan, onCompare, onUse }: { plan: JourneyPlanView; onCompare: () => void; onUse: () => void }) {
  const { scenario, recommendation } = plan;
  const disrupted = recommendation.kind === "change";
  const recommendedOption = plan.alternatives.find(({ journey }) => journey.id === recommendation.journeyId) ?? plan.alternatives[0];
  const recommended = recommendedOption?.journey ?? scenario.usualJourney;

  return (
    <main id="main-content" className="screen today-screen">
      <section className="greeting">
        <span>Friday, 18 September</span>
        <h1>Good morning, Rachel</h1>
        <p>{disrupted ? "Your morning journey needs one change." : "Your usual journey is looking good."}</p>
      </section>

      <div className={`replay-label ${plan.dataMode === "live" ? "live-label" : ""}`}>
        <Radio size={14} />{plan.dataMode === "live" ? `Live sources · Updated ${scenario.updatedAt}` : "Replay scenario · Demo data"}
      </div>
      {plan.providers?.some((provider) => provider.status !== "available") &&
        <div className="provider-warning"><AlertTriangle size={15} />Some live sources are unavailable. Unknown data is not treated as normal.</div>}

      <article className={`recommendation-card ${!disrupted ? "recommendation-card--normal" : ""}`}>
        <div className="decision-label">
          {disrupted ? <AlertTriangle size={15} /> : <Check size={15} />}
          {recommendation.label}
        </div>
        <h2>{recommendation.action}</h2>
        <p>{recommendation.reason}</p>
        <Arrival journey={recommended} deadline={scenario.routine.arrivalDeadline} />
        {recommendedOption && <ReliabilityForecast option={recommendedOption} />}
        <button className="primary-button" onClick={onUse}>
          <Navigation size={18} />Use this route<ArrowRight size={18} />
        </button>
      </article>

      <section className="section-block">
        <div className="section-heading"><div><span>ROUTE OVERVIEW</span><h2>Tampines to Raffles Place</h2></div><button type="button" onClick={onCompare} aria-label="Compare route options"><Menu size={19} /></button></div>
        <RouteMap usual={scenario.usualJourney} recommended={scenario.recommendedJourney} affectedSegments={plan.affectedSegments} compact />
        <div className="route-summary">
          <div><TrainFront size={19} /><span>{recommendation.lineId}<small>{recommendation.lineDetail}</small></span></div>
          <span className="summary-divider" />
          <div><Footprints size={19} /><span>{recommendation.walkingMinutes} min<small>Walking</small></span></div>
          <span className="summary-divider" />
          <div><Users size={19} /><span>{crowdingCopy[recommendation.crowding]}<small>Crowding</small></span></div>
        </div>
      </section>

      {disrupted && (
        <section className="change-explainer">
          <div className="explainer-icon"><AlertTriangle size={19} /></div>
          <div><h2>Why this changed</h2><p>{recommendation.changeExplanation}</p></div>
        </section>
      )}

      <button className="secondary-button" onClick={onCompare}>Compare routes<GitCompareArrows size={18} /></button>
    </main>
  );
}

const crowdingCopy: Record<CrowdingLevel, string> = { low: "Low", moderate: "Moderate", high: "High", unknown: "Unavailable" };

// LTA v3/BusArrival vehicle-load codes. Describes the bus only — never shown as MRT crowding.
const busLoadCopy: Record<BusLoadCode, string> = { SEA: "Seats available", SDA: "Standing available", LSD: "Limited standing" };

const providerTime = (value?: string) => value
  ? new Date(value).toLocaleTimeString("en-SG", { timeZone: "Asia/Singapore", hour12: false, hour: "2-digit", minute: "2-digit" })
  : undefined;

function AccessibilityUnverifiedNote() {
  return (
    <small className="bus-arrival__accessibility">
      <Accessibility size={12} aria-hidden="true" /> Accessibility: Unverified — not confirmed wheelchair- or step-free-accessible
    </small>
  );
}

function BusAccessibilityNote({ accessible }: { accessible?: boolean }) {
  if (!accessible) return <AccessibilityUnverifiedNote />;
  return (
    <small className="bus-arrival__accessibility">
      <Accessibility size={12} aria-hidden="true" /> LTA reports this bus as wheelchair-accessible
    </small>
  );
}

function BusArrivalSummary({ arrival, accessibleMode }: { arrival: BusArrivalInfo; accessibleMode?: boolean }) {
  if (arrival.status !== "available") {
    return (
      <div className="bus-arrival bus-arrival--unavailable">
        <BusFront size={16} />
        <span>
          <strong>Bus {arrival.serviceNo ?? ""} arrival unavailable</strong>
          <small>{arrival.reason ?? "No current data from LTA DataMall."}</small>
          {accessibleMode && <BusAccessibilityNote accessible={arrival.wheelchairAccessible} />}
        </span>
      </div>
    );
  }
  const updated = providerTime(arrival.observedAt);
  return (
    <div className="bus-arrival">
      <BusFront size={16} />
      <span>
        <strong>Bus {arrival.serviceNo} in {arrival.etaMinutes} min</strong>
        <small>Bus load: {arrival.load ? busLoadCopy[arrival.load] : "Unavailable"}{updated ? ` · Updated ${updated} SGT` : ""}</small>
        {accessibleMode && <BusAccessibilityNote accessible={arrival.wheelchairAccessible} />}
      </span>
    </div>
  );
}

const NO_DATA_ARRIVAL: BusArrivalInfo = { status: "unavailable", reason: "No live arrival data was fetched for this leg." };

function BusLegArrivals({ legs, accessibleMode }: { legs: JourneyLeg[]; accessibleMode?: boolean }) {
  const busLegs = legs.filter((leg) => leg.mode === "bus");
  if (busLegs.length === 0) return null;
  return (
    <div className="bus-arrival-list">
      {busLegs.map((leg) => (
        <BusArrivalSummary key={leg.id} arrival={leg.busArrival ?? { ...NO_DATA_ARRIVAL, serviceNo: leg.lineId }} accessibleMode={accessibleMode} />
      ))}
    </div>
  );
}

function RouteOption({ option, affected, accessibleMode, onUse }: { option: Alternative; affected: boolean; accessibleMode: boolean; onUse: (journey: Journey) => void }) {
  const { journey } = option;
  return (
    <article className={`route-option ${option.recommended ? "route-option--recommended" : "route-option--affected"}`}>
      <div className="option-heading">
        <div className="option-label">{option.recommended ? <><Check size={14} />Recommended</> : affected ? <><AlertTriangle size={14} />Usual route · affected</> : "Alternative"}</div>
        <div className="option-outcome"><span>Score {option.score}</span><strong>{journey.arrival.earliest}–{journey.arrival.latest}</strong></div>
      </div>
      <h2>{journey.name}</h2>
      <p>{option.explanation}</p>
      <ReliabilityForecast option={option} />
      {journey.demandForecast && (
        <details className="demand-details">
          <summary>Projected crowding: {crowdingCopy[journey.demandForecast.crowding]} · demo</summary>
          <p>{journey.demandForecast.corridor}<br />Boarding window {new Date(journey.demandForecast.bucketStart).toLocaleTimeString("en-SG", { timeZone: "Asia/Singapore", hour12: false, hour: "2-digit", minute: "2-digit" })}–{new Date(journey.demandForecast.bucketEnd).toLocaleTimeString("en-SG", { timeZone: "Asia/Singapore", hour12: false, hour: "2-digit", minute: "2-digit" })} SGT</p>
          <p>Illustrative volume: {journey.demandForecast.projectedPassengers} passengers. Baseline {journey.demandForecast.baseline} + other displaced commuters {journey.demandForecast.externalSpillover} + net accepted-route shift {journey.demandForecast.netAppShift}.</p>
          <p>Assumed capacity: {journey.demandForecast.assumedCapacity} per window. Added boarding delay: {journey.demandForecast.addedDelayMinutes} min. Existing service-disruption crowd warnings still apply. All values are synthetic assumptions, not measured train occupancy.</p>
        </details>
      )}
      <div className="metric-grid">
        <div><Clock3 size={17} /><span>Depart<strong>{clockTime(journey.departureAt)}</strong></span></div>
        <div><Footprints size={17} /><span>Walking<strong>{journey.legs.filter((leg) => leg.mode === "walk").reduce((sum, leg) => sum + leg.durationMinutes, 0)} min</strong></span></div>
        <div><GitCompareArrows size={17} /><span>Transfers<strong>{option.transfers}</strong></span></div>
        <div><Users size={17} /><span>Crowding<strong>{crowdingCopy[option.crowding]}</strong></span></div>
      </div>
      <BusLegArrivals legs={journey.legs} accessibleMode={accessibleMode} />
      <details className="score-breakdown" open={option.recommended}>
        <summary><span>Why this score</span><small>{option.score}/100 · lower is better</small></summary>
        <ul>
          {option.scoreBreakdown.components.map((component) => (
            <li key={component.key}>
              <div><strong>{component.label}</strong><span>{component.valueLabel} · {Math.round(component.weight * 100)}% weight</span></div>
              <b>+{component.weightedPoints}</b>
            </li>
          ))}
        </ul>
      </details>
      <button className={option.recommended ? "primary-button" : "secondary-button"} onClick={() => onUse(journey)}><Navigation size={18} />Use this route<ArrowRight size={18} /></button>
    </article>
  );
}

function CompareScreen({ scenario, alternatives, affectedSegments, travelMode, onUse }: { scenario: Scenario; alternatives: Alternative[]; affectedSegments: AffectedSegment[]; travelMode: TravelMode; onUse: (journey: Journey) => void }) {
  const accessibleMode = travelMode === "accessible";
  return (
    <main id="main-content" className="screen">
      <section className="page-intro"><span>ROUTE COMPARISON</span><h1>Choose your best way in</h1><p>Compared against your 8:45 arrival deadline.</p></section>
      {alternatives.map((option) => (
        <RouteOption key={option.id} option={option} affected={affectedSegments.length > 0 && option.journey.id === scenario.usualJourney.id}
          accessibleMode={accessibleMode} onUse={onUse} />
      ))}
      <section className="comparison-note">
        <Info size={18} />
        <p><strong>How we compare</strong>Arrival reliability, walking, transfers and crowding are scored for Rachel&apos;s saved routine.
          {accessibleMode && " Accessible mode weights transfers and walking more heavily; it does not filter or verify accessibility."}</p>
      </section>
    </main>
  );
}

function StepIcon({ mode }: { mode: Journey["legs"][number]["mode"] }) {
  if (mode === "walk") return <Footprints size={18} />;
  if (mode === "bus") return <BusFront size={18} />;
  return <TrainFront size={18} />;
}

function JourneyScreen({ scenario, activeJourney, affectedSegments, persistence, travelMode }: {
  scenario: Scenario;
  activeJourney: Journey;
  affectedSegments: AffectedSegment[];
  persistence: "saving" | "saved" | "unavailable";
  travelMode: TravelMode;
}) {
  const accessibleMode = travelMode === "accessible";
  const firstLeg = activeJourney.legs[0];
  const firstTransit = activeJourney.legs.find((leg) => leg.mode === "rail" || leg.mode === "bus");
  return (
    <main id="main-content" className="screen journey-screen">
      <section className="journey-status">
        <div><span>ARRIVE BY</span><strong>{activeJourney.arrival.p50}</strong><small>{activeJourney.arrival.earliest}–{activeJourney.arrival.latest}</small></div>
        <div className="on-time-chip"><Clock3 size={15} />{activeJourney.arrival.latest <= scenario.routine.arrivalDeadline ? "Within deadline" : "Arrival risk"}</div>
      </section>
      <section className="next-action">
        <div className="next-action__eyebrow"><Navigation size={14} />NEXT UP · {firstLeg?.durationMinutes ?? 0} MIN</div>
        <h1>{firstLeg?.instruction ?? "Begin your journey"}</h1>
        <p>{firstTransit ? `Then continue on ${firstTransit.lineName ?? firstTransit.lineId ?? "the recommended service"}.` : "Follow the saved route steps."}</p>
        <div className="progress"><span style={{ width: "12%" }} /></div>
        <small>Demo journey · progress is illustrative</small>
      </section>
      <RouteMap usual={scenario.usualJourney} recommended={activeJourney.id !== scenario.usualJourney.id ? activeJourney : undefined} affectedSegments={affectedSegments} />
      <div className="offline-note"><CloudOff size={17} /><span>
        <strong>{persistence === "saved" ? "Available offline" : persistence === "saving" ? "Saving for offline use" : "Not saved offline"}</strong>
        {persistence === "saved" ? `Journey saved on this device · Updated ${scenario.updatedAt}` : "Keep this page open and try again when storage is available."}
      </span></div>
      <section className="timeline-section">
        <div className="section-heading"><div><span>YOUR JOURNEY</span><h2>{activeJourney.origin.shortName} to {activeJourney.destination.shortName}</h2></div></div>
        <ol className="timeline">
          {activeJourney.legs.map((leg, index) => (
            <li key={leg.id} className={affectedSegments.some(({ firstLegIndex, lastLegIndex }) => index >= firstLegIndex && index <= lastLegIndex) && activeJourney.id === scenario.usualJourney.id ? "timeline-step--affected" : ""}>
              <div className="step-icon"><StepIcon mode={leg.mode} /></div>
              <div>
                <strong>{leg.instruction}</strong>
                <span>{leg.from.shortName} to {leg.to.shortName} · {leg.durationMinutes} min</span>
                {leg.mode === "bus" && (
                  <BusArrivalSummary arrival={leg.busArrival ?? { ...NO_DATA_ARRIVAL, serviceNo: leg.lineId }} accessibleMode={accessibleMode} />
                )}
              </div>
            </li>
          ))}
          <li><div className="step-icon step-icon--destination"><BriefcaseBusiness size={18} /></div><div><strong>Arrive at the office</strong><span>Expected {activeJourney.arrival.p50}</span></div></li>
        </ol>
      </section>
    </main>
  );
}

export function CommuteApp({ initialPlan }: { initialPlan: JourneyPlanView }) {
  const [screen, setScreen] = useState<Screen>("today");
  const [plan, setPlan] = useState(initialPlan);
  const scenario = plan.scenario;
  const [activeJourneyId, setActiveJourneyId] = useState<string>();
  const [announcement, setAnnouncement] = useState("");
  const [online, setOnline] = useState(true);
  const [booting, setBooting] = useState(true);
  const [cached, setCached] = useState(false);
  const [freshness, setFreshness] = useState<"fresh" | "stale" | "expired">("fresh");
  const [persistence, setPersistence] = useState<"saving" | "saved" | "unavailable">("unavailable");
  const [storedSnapshot, setStoredSnapshot] = useState<CachedJourneySnapshot>();
  const [isScenarioLoading, setIsScenarioLoading] = useState(false);
  const [serviceError, setServiceError] = useState<string>();
  const [participating, setParticipating] = useState(false);
  const [demandMessage, setDemandMessage] = useState("");
  const [decisionMessage, setDecisionMessage] = useState<string>();
  const [demandBusy, setDemandBusy] = useState(false);
  const [acceptedJourney, setAcceptedJourney] = useState<Journey>();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [travelMode, setTravelModeState] = useState<TravelMode>("standard");

  const persistPlan = async (nextPlan: JourneyPlanView, selectedJourneyId?: string) => {
    setPersistence("saving");
    try {
      const snapshot = await saveJourneySnapshot(nextPlan, selectedJourneyId);
      setStoredSnapshot(snapshot);
      setFreshness(snapshotFreshness(snapshot));
      setPersistence("saved");
    } catch {
      setPersistence("unavailable");
    }
  };

  const loadLive = async (announce = true, mode = travelMode) => {
    if (!navigator.onLine) throw new Error("You are offline. Showing the saved journey.");
    const routine = await loadRoutine();
    const nextPlan = await requestMorningCheck(routine, mode);
    const changed = plan.recommendation.journeyId !== nextPlan.recommendation.journeyId;
    setPlan(nextPlan);
    setCached(false);
    await persistPlan(nextPlan, activeJourneyId);
    if (announce) setAnnouncement(changed && activeJourneyId
      ? "Live advice changed. Your accepted route remains selected until you choose another."
      : "Live morning check complete.");
    return nextPlan;
  };

  useEffect(() => {
    if (!initialPlan.demand) return;
    let cancelled = false;
    requestParticipation("GET").then((value) => { if (!cancelled) setParticipating(value); })
      .catch(() => { /* Sharing stays off if status cannot be checked. */ });
    return () => { cancelled = true; };
  }, [initialPlan.demand]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("decision");
    if (!id || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)) return;
    let cancelled = false;
    fetch(`/api/notifications/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "Notification decision is unavailable.");
        return payload.data as { title?: string; body?: string };
      })
      .then((decision) => {
        if (cancelled) return;
        const message = [decision.title, decision.body].filter(Boolean).join(" — ");
        setDecisionMessage(message);
        setAnnouncement(message);
      })
      .catch((error) => {
        if (!cancelled) setServiceError(error instanceof Error ? error.message : "Notification decision is unavailable.");
      });
    return () => { cancelled = true; };
  }, []);


  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      setOnline(navigator.onLine);
      const snapshot = await Promise.race([
        loadLatestJourneySnapshot().catch(() => undefined),
        new Promise<undefined>((resolve) => window.setTimeout(() => resolve(undefined), 1_500)),
      ]);
      if (cancelled) return;
      setBooting(false);
      const legacyId = consumeLegacyActiveJourney();
      if (snapshot) {
        setPlan(snapshot.plan);
        setStoredSnapshot(snapshot);
        setActiveJourneyId(snapshot.selectedJourneyId ?? legacyId);
        setCached(true);
        setFreshness(snapshotFreshness(snapshot));
        setPersistence("saved");
      } else if (legacyId) setActiveJourneyId(legacyId);
      if (navigator.onLine) {
        try { await loadLive(false); }
        catch { if (!cancelled) setServiceError("Unable to refresh live data. Showing the last verified view."); }
      }
    };
    let reconnectTimer: number | undefined;
    const updateOnline = () => {
      const value = navigator.onLine;
      setOnline(value);
      if (value) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(() => {
          void loadLive().catch(() => setServiceError("Reconnected, but live data could not be refreshed."));
        }, 800);
      }
    };
    void initialize();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      cancelled = true;
      window.clearTimeout(reconnectTimer);
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
    // Startup runs once; reconnect refreshes use the latest routine from IndexedDB.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [screen]);

  const activeJourney = useMemo(() => {
    if (acceptedJourney) return acceptedJourney;
    const candidates = plan.alternatives.map((option) => option.journey);
    return candidates.find((journey) => journey?.id === activeJourneyId) ?? scenario.recommendedJourney ?? scenario.usualJourney;
  }, [activeJourneyId, acceptedJourney, scenario, plan.alternatives]);

  const selectRoute = (choice?: Journey) => {
    if (demandBusy || isScenarioLoading) return;
    const selected = choice ?? plan.alternatives.find(({ journey }) => journey.id === plan.recommendation.journeyId)?.journey ?? scenario.usualJourney;
    setAcceptedJourney(selected);
    setActiveJourneyId(selected.id);
    if (storedSnapshot) void updateSelectedJourney(storedSnapshot, selected.id).then(setStoredSnapshot)
      .catch(() => setPersistence("unavailable"));
    else void persistPlan(plan, selected.id);
    setAnnouncement(`${selected.name} selected. Your active route will not change automatically.`);
    setScreen("journey");
    if (participating && online && plan.demand && plan.demand.profile !== "unavailable") {
      setDemandBusy(true);
      requestParticipation("POST", { action: "accept", scenarioId: scenario.id,
        profile: plan.demand.profile, journeyId: selected.id })
        .then(() => setDemandMessage("Demo selection shared. Refresh to see its effect. Your selected journey stays unchanged."))
        .catch((error) => setDemandMessage(`Route selected, but not shared: ${error.message}`))
        .finally(() => setDemandBusy(false));
    }
  };

  const refreshDemand = async (profile: DemandProfile) => {
    setDemandBusy(true);
    try {
      setPlan(await requestJourneyPlan(scenario.id, profile, travelMode));
      setDemandMessage("Projection updated. Any active journey remains unchanged until you choose another route.");
    } catch { setDemandMessage("Refresh failed. Showing the previous projection; it may be stale. Try again when connected."); }
    finally { setDemandBusy(false); }
  };

  const updateParticipation = async (enabled: boolean) => {
    setDemandBusy(true);
    try {
      const value = await requestParticipation(enabled ? "POST" : "DELETE", enabled ? { action: "consent", consent: true } : undefined);
      setParticipating(value);
      setDemandMessage(value ? "Sharing enabled for 30 minutes. Only future route selections are shared." : "Sharing off. Your server selection and cookie have been deleted.");
    } catch (error) { setDemandMessage(error instanceof Error ? error.message : "Could not change participation. Try again."); }
    finally { setDemandBusy(false); }
  };

  const changeMode = async (mode: "live" | Scenario["id"]) => {
    setIsScenarioLoading(true);
    setServiceError(undefined);
    try {
      const nextPlan = mode === "live" ? await loadLive() : await requestJourneyPlan(mode, plan.demand?.profile, travelMode);
      setPlan(nextPlan);
      setCached(false);
      if (mode !== "live") await persistPlan(nextPlan);
      setActiveJourneyId(undefined);
      setAcceptedJourney(undefined);
      setScreen("today");
      setAnnouncement(`${nextPlan.scenario.label} loaded.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to refresh the journey.";
      setServiceError(message);
      setAnnouncement(message);
    } finally {
      setIsScenarioLoading(false);
    }
  };

  const changeTravelMode = async (mode: TravelMode) => {
    setTravelModeState(mode);
    setIsScenarioLoading(true);
    setServiceError(undefined);
    try {
      const nextPlan = plan.dataMode === "live"
        ? await loadLive(false, mode)
        : await requestJourneyPlan(scenario.id, plan.demand?.profile, mode);
      setPlan(nextPlan);
      setCached(false);
      if (plan.dataMode !== "live") await persistPlan(nextPlan, activeJourneyId);
      setAnnouncement(`${mode === "accessible" ? "Accessible" : "Standard"} travel mode applied.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update travel mode.";
      setServiceError(message);
      setAnnouncement(message);
    } finally {
      setIsScenarioLoading(false);
    }
  };

  const showComparison = () => {
    setScreen("compare");
    setAnnouncement("Route comparison opened.");
  };

  const openRoutineProfile = () => {
    setScreen("today");
    setAnnouncement("Rachel's saved routine opened.");
    window.setTimeout(() => {
      const editor = document.querySelector<HTMLDetailsElement>("#routine-editor");
      if (!editor) return;
      editor.open = true;
      editor.scrollIntoView({ behavior: "smooth", block: "start" });
      editor.querySelector<HTMLElement>("summary")?.focus();
    }, 0);
  };

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <GovernmentBanner onAbout={() => setAboutOpen(true)} />
      <Header scenario={scenario} travelMode={travelMode} onMode={changeMode} onTravelMode={changeTravelMode} onCompare={showComparison} onProfile={openRoutineProfile}
        isLoading={isScenarioLoading || demandBusy || booting} />
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {booting && <div className="offline-banner" role="status"><RefreshCw size={16} />Loading saved journey...</div>}
      {!online && <div className="offline-banner" role="status"><CloudOff size={16} />Offline · {storedSnapshot ? "showing your saved journey" : "no saved journey is available"}</div>}
      {cached && <div className="decision-banner" role="status"><CloudOff size={16} />Cached device data · {freshness === "fresh" ? "within provider validity" : freshness}</div>}
      {serviceError && <div className="service-error" role="alert"><AlertTriangle size={16} />{serviceError}</div>}
      {decisionMessage && <div className="decision-banner" role="status"><Radio size={16} />{decisionMessage}</div>}
      <div className="live-region" aria-live="polite">{announcement}</div>
      {screen === "today" && <TodayScreen plan={plan} onCompare={showComparison} onUse={() => selectRoute()} />}
      {screen === "compare" && <CompareScreen scenario={scenario} alternatives={plan.alternatives} affectedSegments={plan.affectedSegments} travelMode={travelMode} onUse={selectRoute} />}
      {screen === "journey" && <JourneyScreen scenario={scenario} activeJourney={activeJourney} affectedSegments={plan.affectedSegments} persistence={persistence} travelMode={travelMode} />}
      {plan.demand && <DemandPanel demand={plan.demand} participating={participating}
        busy={demandBusy || isScenarioLoading} online={online} message={demandMessage}
        onRefresh={refreshDemand} onParticipation={updateParticipation} />}
      {screen === "today" && <ReliabilityPanel plan={plan} onRefresh={async () => { await changeMode(scenario.id); }} />}
      {screen === "today" && <RoutinePanel onPlan={(nextPlan) => {
        setPlan(nextPlan);
        setCached(false);
        setActiveJourneyId(undefined);
        void persistPlan(nextPlan);
        setAnnouncement("Live morning check complete.");
      }} />}
      <nav className="bottom-nav" aria-label="Primary navigation">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button key={id} className={screen === id ? "active" : ""} onClick={() => setScreen(id)} aria-current={screen === id ? "page" : undefined}>
            <Icon size={20} /><span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
