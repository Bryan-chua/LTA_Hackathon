"use client";

import { useEffect, useMemo, useState } from "react";
import type { JourneyPlanView } from "@/lib/application/journey-view-model";
import { requestReliabilityConsent, submitReliabilityFeedback } from "@/lib/application/journey-api-client";

export function ReliabilityPanel({ plan, onRefresh }: { plan: JourneyPlanView; onRefresh: () => Promise<void> }) {
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [arrivedOnTime, setArrivedOnTime] = useState(true);
  const [tookRecommended, setTookRecommended] = useState(true);
  const [actualArrival, setActualArrival] = useState("");
  const selected = useMemo(() => plan.alternatives.find((option) => option.recommended), [plan.alternatives]);

  useEffect(() => {
    requestReliabilityConsent("GET").then(setConsented).catch(() => setConsented(false));
  }, []);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      const next = await requestReliabilityConsent(enabled ? "POST" : "DELETE");
      setConsented(next);
      if (next) {
        await onRefresh();
        setMessage("Forecast improvement is on. New route checks can be labelled for up to 90 days.");
      } else {
        setMessage("Forecast improvement is off. Your server observation history was deleted.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update forecast consent.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const observationId = selected?.reliability.observationId;
    if (!observationId) {
      setMessage("Run or refresh this route after enabling forecast improvement first.");
      return;
    }
    setBusy(true);
    try {
      await submitReliabilityFeedback({
        observationId,
        arrivedBeforeDeadline: arrivedOnTime,
        tookRecommended,
        ...(actualArrival ? { actualArrival } : {}),
      });
      setMessage("Journey outcome saved. You can submit again to correct it.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save journey feedback.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="reliability-panel" aria-labelledby="reliability-improvement-title">
      <h2 id="reliability-improvement-title">Improve reliability forecasts</h2>
      <p>Optional feedback stores a pseudonymous route signature, conditions and your confirmed outcome for 90 days. No address labels or GPS trail are collected.</p>
      <label className="reliability-consent">
        <input type="checkbox" checked={consented} disabled={busy}
          onChange={(event) => void toggle(event.target.checked)} />
        Share journey outcomes to improve forecasts
      </label>
      {consented && <div className="reliability-feedback">
        <label>Arrived before the deadline?
          <select value={arrivedOnTime ? "yes" : "no"} onChange={(event) => setArrivedOnTime(event.target.value === "yes")}>
            <option value="yes">Yes</option><option value="no">No</option>
          </select>
        </label>
        <label>Took the recommended route?
          <select value={tookRecommended ? "yes" : "no"} onChange={(event) => setTookRecommended(event.target.value === "yes")}>
            <option value="yes">Yes</option><option value="no">No</option>
          </select>
        </label>
        <label>Actual arrival (optional)
          <input type="time" value={actualArrival} onChange={(event) => setActualArrival(event.target.value)} />
        </label>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void save()}>Save journey outcome</button>
      </div>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
