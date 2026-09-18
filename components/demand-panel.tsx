"use client";

import type { DemandProfile, DemandView } from "@/lib/demand-flow";

interface Props {
  demand: DemandView;
  participating: boolean;
  busy: boolean;
  online: boolean;
  message: string;
  onRefresh: (profile: DemandProfile) => void;
  onParticipation: (enabled: boolean) => void;
}

export function DemandPanel({ demand, participating, busy, online, message, onRefresh, onParticipation }: Props) {
  return (
    <section className="demand-panel" aria-labelledby="demand-title">
      <div className="section-heading"><div><span>DEMAND REPLAY · SYNTHETIC DATA</span><h2 id="demand-title">Where will commuters go next?</h2></div></div>
      <p>See how accepted reroutes change expected crowding. These are demonstration estimates, not live passenger counts.</p>
      <label htmlFor="demand-profile">Replay conditions</label>
      <select id="demand-profile" value={demand.profile} disabled={busy || !online}
        onChange={(event) => onRefresh(event.target.value as DemandProfile)}>
        <option value="typical">Typical demand</option>
        <option value="surge">DTL surge · test another corridor</option>
        <option value="unavailable">Forecast unavailable</option>
      </select>
      {demand.status === "unavailable" ? <p role="status">Demand forecast unavailable. Using the original route estimates; no new selections will be shared.</p> :
        <p>Replay clock: 18 Sep 2026, 07:30 SGT. Five-minute boarding windows. Real crowd levels and forecast accuracy are unverified.</p>}
      {!online && <p role="status">Offline. The displayed projection is saved screen data; reconnect and refresh before relying on it.</p>}
      <button className="secondary-button" disabled={busy || !online} onClick={() => onRefresh(demand.profile)}>
        {busy ? "Updating…" : "Refresh demand estimate"}
      </button>
      <details>
        <summary>Help test the feedback loop</summary>
        <p>Optional: share only your selected demo route and scenario with this demo server; its boarding window comes from the fixture. A random browser cookie links your selection for up to 30 minutes. We do not request your location or actual commute.</p>
        <p>Repeated selections replace the previous choice. The server keeps this demo participation in memory; it expires after 30 minutes and is removed on the next request or server restart. Turning it off deletes your current selection immediately. Routing works without participating.</p>
        <label className="demand-consent"><input type="checkbox" checked={participating} disabled={busy || !online}
          onChange={(event) => onParticipation(event.target.checked)} />Share my demo route selections</label>
        <small>This cookie is pseudonymous, not proof that the data is anonymous. No real commuter data should be entered in this demo.</small>
      </details>
      <p role="status" aria-live="polite">{message}</p>
    </section>
  );
}
