"use client";

import {
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
import type { AffectedSegment, Alternative, CrowdingLevel, Journey, Scenario } from "@/lib/domain";
import { requestJourneyPlan, requestParticipation } from "@/lib/application/journey-api-client";
import type { JourneyPlanView } from "@/lib/application/journey-view-model";
import { RouteMap } from "./route-map";
import { DemandPanel } from "./demand-panel";
import type { DemandProfile } from "@/lib/demand-flow";
import { RoutinePanel } from "./routine-panel";

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

function GovernmentBanner() {
  return (
    <div className="government-banner">
      <ShieldCheck size={13} aria-hidden="true" />
      <span>Hackathon concept · Unofficial commuter demo</span>
      <button aria-label="About this concept"><Info size={13} /></button>
    </div>
  );
}

function Header({ scenario, onToggle, isLoading }: { scenario: Scenario; onToggle: () => void; isLoading: boolean }) {
  return (
    <>
      <header className="brand-header">
        <div className="brand-lockup">
          <BrandMark />
          <div><strong>Smart Commute</strong><small>Hackathon concept</small></div>
        </div>
        <div className="header-actions">
          <button className="scenario-button" onClick={onToggle} aria-label="Change demo scenario" disabled={isLoading}>
            <RefreshCw size={15} />
            <span>{isLoading ? "Loading" : scenario.id === "normal" ? "Show replay" : "Show normal"}</span>
          </button>
          <button className="avatar" aria-label="Open Rachel's profile">R</button>
        </div>
      </header>
      {scenario.isReplay && (
        <div className="advisory" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <div><strong>EWL service disruption affects your journey</strong><span>Updated {scenario.updatedAt}</span></div>
          <ChevronRight size={18} aria-hidden="true" />
        </div>
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

function TodayScreen({ plan, onCompare, onUse }: { plan: JourneyPlanView; onCompare: () => void; onUse: () => void }) {
  const { scenario, recommendation } = plan;
  const disrupted = recommendation.kind === "change";
  const recommended = plan.alternatives.find(({ journey }) => journey.id === recommendation.journeyId)?.journey ?? scenario.usualJourney;

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
        <button className="primary-button" onClick={onUse}>
          <Navigation size={18} />Use this route<ArrowRight size={18} />
        </button>
      </article>

      <section className="section-block">
        <div className="section-heading"><div><span>ROUTE OVERVIEW</span><h2>Tampines to Raffles Place</h2></div><button aria-label="More route options"><Menu size={19} /></button></div>
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

function RouteOption({ option, affected, onUse }: { option: Alternative; affected: boolean; onUse: (journey: Journey) => void }) {
  const { journey } = option;
  return (
    <article className={`route-option ${option.recommended ? "route-option--recommended" : "route-option--affected"}`}>
      <div className="option-heading">
        <div className="option-label">{option.recommended ? <><Check size={14} />Recommended</> : affected ? <><AlertTriangle size={14} />Usual route · affected</> : "Alternative"}</div>
        <div className="option-outcome"><span>Score {option.score}</span><strong>{journey.arrival.earliest}–{journey.arrival.latest}</strong></div>
      </div>
      <h2>{journey.name}</h2>
      <p>{option.explanation}</p>
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

function CompareScreen({ scenario, alternatives, onUse }: { scenario: Scenario; alternatives: Alternative[]; onUse: (journey: Journey) => void }) {
  return (
    <main id="main-content" className="screen">
      <section className="page-intro"><span>ROUTE COMPARISON</span><h1>Choose your best way in</h1><p>Compared against your 8:45 arrival deadline.</p></section>
      {alternatives.map((option) => <RouteOption key={option.id} option={option} affected={scenario.conditions.length > 0 && option.journey.id === scenario.usualJourney.id} onUse={onUse} />)}
      <section className="comparison-note"><Info size={18} /><p><strong>How we compare</strong>Arrival reliability, walking, transfers and crowding are scored for Rachel&apos;s saved routine.</p></section>
    </main>
  );
}

function StepIcon({ mode }: { mode: Journey["legs"][number]["mode"] }) {
  if (mode === "walk") return <Footprints size={18} />;
  if (mode === "bus") return <BusFront size={18} />;
  return <TrainFront size={18} />;
}

function JourneyScreen({ scenario, activeJourney, affectedSegments }: { scenario: Scenario; activeJourney: Journey; affectedSegments: AffectedSegment[] }) {
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
      <div className="offline-note"><CloudOff size={17} /><span><strong>Available offline</strong>Journey saved on this device · Updated {scenario.updatedAt}</span></div>
      <section className="timeline-section">
        <div className="section-heading"><div><span>YOUR JOURNEY</span><h2>{activeJourney.origin.shortName} to {activeJourney.destination.shortName}</h2></div></div>
        <ol className="timeline">
          {activeJourney.legs.map((leg, index) => (
            <li key={leg.id} className={affectedSegments.some(({ firstLegIndex, lastLegIndex }) => index >= firstLegIndex && index <= lastLegIndex) && activeJourney.id === scenario.usualJourney.id ? "timeline-step--affected" : ""}>
              <div className="step-icon"><StepIcon mode={leg.mode} /></div>
              <div><strong>{leg.instruction}</strong><span>{leg.from.shortName} to {leg.to.shortName} · {leg.durationMinutes} min</span></div>
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
  const [isScenarioLoading, setIsScenarioLoading] = useState(false);
  const [serviceError, setServiceError] = useState<string>();
  const [participating, setParticipating] = useState(false);
  const [demandMessage, setDemandMessage] = useState("");
  const [decisionMessage, setDecisionMessage] = useState<string>();
  const [demandBusy, setDemandBusy] = useState(false);
  const [activeSnapshot, setActiveSnapshot] = useState<Journey>();

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
    const restoreSavedJourney = () => {
      const stored = window.localStorage.getItem("smart-commute-active-journey");
      if (stored) setActiveJourneyId(stored);
    };
    const updateOnline = () => setOnline(navigator.onLine);
    const initialization = window.setTimeout(() => {
      restoreSavedJourney();
      updateOnline();
    }, 0);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    window.addEventListener("storage", restoreSavedJourney);
    return () => {
      window.clearTimeout(initialization);
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      window.removeEventListener("storage", restoreSavedJourney);
    };
  }, []);

  useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [screen]);

  const activeJourney = useMemo(() => {
    if (activeSnapshot) return activeSnapshot;
    const candidates = plan.alternatives.map((option) => option.journey);
    return candidates.find((journey) => journey?.id === activeJourneyId) ?? scenario.recommendedJourney ?? scenario.usualJourney;
  }, [activeJourneyId, activeSnapshot, scenario, plan.alternatives]);

  const selectRoute = (choice?: Journey) => {
    if (demandBusy || isScenarioLoading) return;
    const selected = choice ?? plan.alternatives.find(({ journey }) => journey.id === plan.recommendation.journeyId)?.journey ?? scenario.usualJourney;
    try { window.localStorage.setItem("smart-commute-active-journey", selected.id); } catch { /* Route remains usable in memory. */ }
    setActiveSnapshot(selected);
    setActiveJourneyId(selected.id);
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
      setPlan(await requestJourneyPlan(scenario.id, profile));
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

  const toggleScenario = async () => {
    const nextScenarioId: Scenario["id"] = scenario.id === "normal" ? "ewl-disruption" : "normal";
    setIsScenarioLoading(true);
    setServiceError(undefined);
    try {
      const nextPlan = await requestJourneyPlan(nextScenarioId, plan.demand?.profile);
      setPlan(nextPlan);
      setActiveJourneyId(undefined);
      setActiveSnapshot(undefined);
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

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <GovernmentBanner />
      <Header scenario={scenario} onToggle={toggleScenario} isLoading={isScenarioLoading || demandBusy} />
      {!online && <div className="offline-banner" role="status"><CloudOff size={16} />Offline · showing your saved journey</div>}
      {serviceError && <div className="service-error" role="alert"><AlertTriangle size={16} />{serviceError}</div>}
      {decisionMessage && <div className="decision-banner" role="status"><Radio size={16} />{decisionMessage}</div>}
      <div className="live-region" aria-live="polite">{announcement}</div>
      {screen === "today" && <TodayScreen plan={plan} onCompare={() => setScreen("compare")} onUse={() => selectRoute()} />}
      {screen === "compare" && <CompareScreen scenario={scenario} alternatives={plan.alternatives} onUse={selectRoute} />}
      {screen === "journey" && <JourneyScreen scenario={scenario} activeJourney={activeJourney} affectedSegments={plan.affectedSegments} />}
      {plan.demand && <DemandPanel demand={plan.demand} participating={participating}
        busy={demandBusy || isScenarioLoading} online={online} message={demandMessage}
        onRefresh={refreshDemand} onParticipation={updateParticipation} />}
      {screen === "today" && <RoutinePanel onPlan={(nextPlan) => { setPlan(nextPlan); setActiveJourneyId(undefined); setAnnouncement("Live morning check complete."); }} />}
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
