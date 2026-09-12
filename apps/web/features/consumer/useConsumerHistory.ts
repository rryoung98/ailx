"use client";
import { useEffect, useState } from "react";
import { parseConsumerHistory, type ConsumerAttempt } from "@ailx/session";
export const CONSUMER_STORAGE_KEY = "foray:consumer-demo-history:v1";
type HistoryState = { kind: "loading" } | {
  kind: "ready"; attempts: ConsumerAttempt[]; durable: boolean; notice: string;
};
export function useConsumerHistory() {
  const [state, setState] = useState<HistoryState>({ kind: "loading" });
  useEffect(() => {
    const read = () => {
      try {
        const attempts = parseConsumerHistory(window.localStorage.getItem(CONSUMER_STORAGE_KEY));
        setState(previous => previous.kind === "ready" && !previous.durable
          ? previous
          : { kind: "ready", attempts, durable: true, notice: "" });
      } catch {
        setState(previous => ({ kind: "ready", attempts: previous.kind === "ready" ? previous.attempts : [], durable: false,
          notice: "Saved tests could not be read. You can try this session, but it will not be saved. Existing stored data has not been changed." }));
      }
    };
    read();
    const changed = (event: StorageEvent) => { if (event.key === CONSUMER_STORAGE_KEY || event.key === null) read(); };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);

  function update(change: (attempts: ConsumerAttempt[]) => ConsumerAttempt[]): boolean {
    if (state.kind !== "ready") return false;
    let current = state.attempts;
    if (state.durable) {
      try { current = parseConsumerHistory(window.localStorage.getItem(CONSUMER_STORAGE_KEY)); }
      catch {
        setState({ ...state, durable: false, notice: "Storage is unavailable. Your current session is still here. Try again to continue without saving." });
        return false;
      }
    }
    let next: ConsumerAttempt[];
    try { next = change(current); }
    catch (error) {
      setState({ ...state, attempts: current, notice: error instanceof Error ? error.message : "This test changed in another tab. Reload to continue." });
      return false;
    }
    let durable = state.durable;
    let notice = state.notice;
    if (durable) {
      try { window.localStorage.setItem(CONSUMER_STORAGE_KEY, JSON.stringify(next)); }
      catch { durable = false; notice = "This session could not be saved. Keep this page open to finish; reloading may lose your latest decisions."; }
    }
    setState({ kind: "ready", attempts: next, durable, notice });
    return true;
  }
  return { state, update };
}
