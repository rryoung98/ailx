"use client";

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

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
 *
 * It is the first ENABLED focusable element, not the first `<button>`:
 * `focus()` on a disabled control does nothing at all, so picking one is the
 * same no-op as never having called this — and the drill reaches that case
 * today, with a retry button that reads "Sending…" while a round is in
 * flight. A stage that legitimately holds no control (the drill's "Dealing a
 * round…") falls back to the stage itself, which is why the elements this is
 * pointed at carry `tabIndex={-1}`.
 */
/**
 * What replaced the control the user just pressed, in preference order.
 *
 * A CONTROL first — the call buttons, the "Next card" — because that is the
 * thing the pressed control was replaced BY. Only then anything else focus()
 * can land on: the feedback panel puts the picture's credit link ahead of
 * "Next card" in document order, and handing a keyboard user a source link
 * where they expected the next action is a worse landing than the one it
 * replaced. `[tabindex]` is in the second list because a `tabIndex={-1}`
 * heading or stage is focusable programmatically, which is what this does.
 */
const FOCUSABLE = [
  // `input[type=hidden]` is an `input` that renders nothing and takes no
  // focus: `focus()` on it is the same silent no-op as a disabled control,
  // which is the defect this hook exists to prevent. It is excluded in the
  // SELECTOR rather than in `isFocusable` because it is not "hidden" in any
  // sense that element carries — `el.hidden` is false and it is not
  // `aria-hidden` — so only the type tells you.
  "button, input:not([type=hidden]), select, textarea",
  "a[href], [tabindex]",
];

/** Whether `focus()` on this element would do anything. */
function isFocusable(el: HTMLElement): boolean {
  // A disabled control swallows focus() silently — the whole point of the
  // check — as does one the page has hidden.
  if ("disabled" in el && el.disabled === true) return false;
  return !el.hidden && el.getAttribute("aria-hidden") !== "true";
}

export function useFocusRecovery<T extends HTMLElement>(): {
  stageRef: RefObject<T | null>;
  recoverFocus: () => void;
} {
  const stageRef = useRef<T>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!pending) return;
    setPending(false);
    const stage = stageRef.current;
    if (stage === null) return;
    const target =
      FOCUSABLE.reduce<HTMLElement | undefined>(
        (found, selector) =>
          found ?? [...stage.querySelectorAll<HTMLElement>(selector)].find(isFocusable),
        undefined,
      ) ?? (stage.hasAttribute("tabindex") ? stage : undefined);
    target?.focus();
  }, [pending]);
  // Stable, so a caller may list it in a `useCallback`/`useEffect` dependency
  // array without re-creating the handler on every render.
  const recoverFocus = useCallback(() => setPending(true), []);
  return { stageRef, recoverFocus };
}
