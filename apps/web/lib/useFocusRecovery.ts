"use client";

import { type RefObject, useEffect, useRef, useState } from "react";

/**
 * Focus recovery for a stage that unmounts the control the user just pressed.
 *
 * Answering a card, skipping it or asking for the picture again all replace
 * the buttons in the stage, and the browser drops focus on `<body>` when the
 * focused control goes away. A keyboard or screen-reader user then tabs back
 * through the skip link, the wordmark and the whole nav, twice per card —
 * which is a measurement defect, not a polish one (FRONTEND.md §5).
 *
 * Call `recoverFocus()` from the handler that is about to swap the controls.
 * The move happens in an effect, AFTER the replacement has rendered, so the
 * focus lands on the first control of what replaced it.
 */
export function useFocusRecovery<T extends HTMLElement>(): {
  stageRef: RefObject<T | null>;
  recoverFocus: () => void;
} {
  const stageRef = useRef<T>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!pending) return;
    stageRef.current?.querySelector("button")?.focus();
    setPending(false);
  }, [pending]);
  return { stageRef, recoverFocus: () => setPending(true) };
}
