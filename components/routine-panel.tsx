"use client";

import { Bell, BellOff, MapPin, RefreshCw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { JourneyPlanView } from "@/lib/application/journey-view-model";
import type { Place, Routine } from "@/lib/domain";
import { defaultRoutine, loadRoutine, resetRoutine, saveRoutine } from "@/lib/client/routine-store";

interface GeocodeResult { name: string; address: string; coordinate: Place["coordinate"] }
interface Props { onPlan: (plan: JourneyPlanView) => void }

const evaluationProfile = (routine: Routine) => ({
  origin: { lat: routine.origin.coordinate.lat, lng: routine.origin.coordinate.lng },
  destination: { lat: routine.destination.coordinate.lat, lng: routine.destination.coordinate.lng },
  departureTime: routine.departureTime,
  arrivalDeadline: routine.arrivalDeadline,
  weekdays: routine.weekdays,
  timezone: "Asia/Singapore" as const,
  materialDelayMinutes: routine.materialDelayMinutes ?? 10,
  enabled: routine.enabled,
});

const applicationServerKey = (value: string) => {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const bytes = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
};
const PUSH_OPT_IN_KEY = "smart-commute-push-enabled";

async function createBrowserSubscription(registration: ServiceWorkerRegistration) {
  const keyResponse = await fetch("/api/push/public-key", { cache: "no-store" });
  const keyPayload = await keyResponse.json();
  if (!keyResponse.ok) throw new Error(keyPayload.error?.message ?? "Push is not configured.");
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(keyPayload.data.publicKey),
  });
}

async function synchronizeSubscription(subscription: PushSubscription, routine: Routine) {
  const json = subscription.toJSON();
  return fetch("/api/push/subscription", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, profile: evaluationProfile(routine) }),
  });
}

export function RoutinePanel({ onPlan }: Props) {
  const [routine, setRoutine] = useState<Routine>(defaultRoutine);
  const [query, setQuery] = useState({ origin: "", destination: "" });
  const [results, setResults] = useState<{ kind: "origin" | "destination"; items: GeocodeResult[] }>();
  const [message, setMessage] = useState("Routine stays on this device unless you enable commute alerts.");
  const [busy, setBusy] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    let active = true;
    const reconcile = async () => {
      const saved = await loadRoutine();
      if (active) setRoutine(saved);
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      const restore = localStorage.getItem(PUSH_OPT_IN_KEY) === "true" && Notification.permission === "granted";
      if (!subscription && restore) subscription = await createBrowserSubscription(registration);
      if (!active) return;
      setSubscribed(Boolean(subscription));
      if (subscription) {
        const response = await synchronizeSubscription(subscription, saved);
        if (!response.ok) setMessage("Browser alerts exist, but the server schedule could not be reconciled.");
      }
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "push-subscription-changed") void reconcile();
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    void reconcile().catch(() => {
      if (active) setMessage("The saved routine loaded, but alert status could not be reconciled.");
    });
    return () => {
      active = false;
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, []);

  const update = <K extends keyof Routine>(key: K, value: Routine[K]) => setRoutine((current) => ({ ...current, [key]: value }));

  const search = async (kind: "origin" | "destination") => {
    setBusy(true);
    try {
      const response = await fetch("/api/geocode", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: query[kind] }), signal: AbortSignal.timeout(10_000),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Address search failed.");
      setResults({ kind, items: payload.data });
      setMessage(payload.data.length ? "Select the exact OneMap result." : "No matching Singapore address found.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Address search failed."); }
    finally { setBusy(false); }
  };

  const choose = (item: GeocodeResult) => {
    if (!results) return;
    const place = { name: item.address, shortName: item.name, coordinate: item.coordinate };
    update(results.kind, place);
    setQuery((current) => ({ ...current, [results.kind]: item.address }));
    setResults(undefined);
  };

  const persist = async () => {
    setBusy(true);
    try {
      await saveRoutine(routine);
      if (subscribed) {
        const response = await fetch("/api/push/profile", {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify(evaluationProfile(routine)),
        });
        if (!response.ok) throw new Error("Saved on device, but the alert schedule could not be updated.");
      }
      setMessage(subscribed ? "Routine saved and alert schedule updated." : "Routine saved on this device.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Routine could not be saved."); }
    finally { setBusy(false); }
  };

  const runCheck = async () => {
    setBusy(true);
    try {
      await saveRoutine(routine);
      const response = await fetch("/api/morning-check", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ routine, dataMode: "live" }), signal: AbortSignal.timeout(25_000),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Morning check failed.");
      onPlan(payload.data.plan);
      setMessage(payload.data.decision.body);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Morning check failed."); }
    finally { setBusy(false); }
  };

  const enableAlerts = async () => {
    setBusy(true);
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Web Push is not supported in this browser.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notification permission was not granted.");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await createBrowserSubscription(registration);
      const response = await synchronizeSubscription(subscription, routine);
      const payload = await response.json();
      if (!response.ok) { await subscription.unsubscribe(); throw new Error(payload.error?.message ?? "Could not enable alerts."); }
      localStorage.setItem(PUSH_OPT_IN_KEY, "true");
      setSubscribed(true);
      setMessage(`Commute alerts enabled. Next scheduled check: ${new Date(payload.data.nextCheckAt).toLocaleString("en-SG")}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not enable alerts."); }
    finally { setBusy(false); }
  };

  const disableAlerts = async () => {
    setBusy(true);
    try {
      localStorage.removeItem(PUSH_OPT_IN_KEY);
      const registration = await navigator.serviceWorker.ready;
      await (await registration.pushManager.getSubscription())?.unsubscribe();
      const response = await fetch("/api/push/subscription", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not remove server notification data.");
      setSubscribed(false);
      setMessage("Commute alerts disabled and the server evaluation profile was deleted.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not disable alerts."); }
    finally { setBusy(false); }
  };

  const restore = async () => {
    const value = await resetRoutine();
    setRoutine(value);
    setQuery({ origin: "", destination: "" });
    setMessage("Rachel’s demo routine restored.");
  };

  return (
    <section className="routine-panel" aria-labelledby="routine-title">
      <div className="section-heading"><div><span>MY ROUTINE</span><h2 id="routine-title">Morning commute</h2></div></div>
      <details>
        <summary>Edit saved routine</summary>
        {(["origin", "destination"] as const).map((kind) => (
          <div className="routine-search" key={kind}>
            <label htmlFor={`routine-${kind}`}>{kind === "origin" ? "Origin" : "Destination"}</label>
            <div><input id={`routine-${kind}`} value={query[kind]} placeholder={routine[kind].name}
              onChange={(event) => setQuery((current) => ({ ...current, [kind]: event.target.value }))} />
              <button type="button" onClick={() => search(kind)} disabled={busy}><Search size={17} />Search</button></div>
            <small><MapPin size={12} />Selected: {routine[kind].name}</small>
          </div>
        ))}
        {results && <div className="geocode-results" role="listbox" aria-label="OneMap address results">
          {results.items.map((item) => <button type="button" key={`${item.coordinate.lat}-${item.coordinate.lng}`} onClick={() => choose(item)}>
            <strong>{item.name}</strong><span>{item.address}</span>
          </button>)}
        </div>}
        <div className="routine-time-grid">
          <label>Departure<input type="time" value={routine.departureTime} onChange={(event) => update("departureTime", event.target.value)} /></label>
          <label>Arrive by<input type="time" value={routine.arrivalDeadline} onChange={(event) => update("arrivalDeadline", event.target.value)} /></label>
        </div>
        <fieldset><legend>Travel days</legend><div className="weekday-grid">
          {["S","M","T","W","T","F","S"].map((label, day) => <label key={day}><input type="checkbox" checked={routine.weekdays.includes(day)}
            onChange={(event) => update("weekdays", event.target.checked ? [...routine.weekdays, day].sort() : routine.weekdays.filter((value) => value !== day))} />{label}</label>)}
        </div></fieldset>
        <button className="secondary-button" type="button" disabled={busy} onClick={persist}>Save routine</button>
        <button className="text-button" type="button" disabled={busy} onClick={restore}><RefreshCw size={15} />Reset to Rachel demo</button>
      </details>
      <button className="primary-button" type="button" disabled={busy || !routine.enabled} onClick={runCheck}>
        <RefreshCw size={18} />{busy ? "Checking…" : "Run live morning check"}
      </button>
      <button className="secondary-button" type="button" disabled={busy} onClick={subscribed ? disableAlerts : enableAlerts}>
        {subscribed ? <BellOff size={18} /> : <Bell size={18} />}{subscribed ? "Disable commute alerts" : "Enable commute alerts"}
      </button>
      <p className="routine-privacy">The editable routine is stored in IndexedDB. With alerts enabled, only coordinates, schedule, deadline and threshold are copied to the server; names and address labels stay on this device. On iPhone or iPad, add this app to the Home Screen first.</p>
      <p role="status" aria-live="polite">{message}</p>
    </section>
  );
}
