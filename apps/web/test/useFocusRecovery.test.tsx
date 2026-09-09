// @vitest-environment jsdom
/**
 * `useFocusRecovery` — the hook that puts focus back into a stage whose
 * controls have just been swapped out from under the user.
 *
 * The two things it has to get right are proved here, because both are
 * silent when they are wrong: focus lands on `<body>`, the page looks
 * correct, and only a keyboard or screen-reader user pays for it.
 *
 *  - `focus()` on a DISABLED control does nothing at all, so the recovery
 *    has to pick the first ENABLED focusable element rather than the first
 *    `<button>` in the markup. That is reachable in the drill today: the
 *    retry button in the finished round reads "Sending…" and is disabled
 *    while the round is in flight.
 *  - a stage can legitimately hold nothing focusable — the drill's "Dealing
 *    a round…" is exactly that — so a stage that is itself focusable
 *    (`tabIndex={-1}`) is the fallback rather than nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useFocusRecovery } from "../lib/useFocusRecovery";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function Harness({ stage, focusableStage = false }: { stage: ReactNode; focusableStage?: boolean }) {
  const { stageRef, recoverFocus } = useFocusRecovery<HTMLDivElement>();
  return (
    <>
      <button type="button" data-testid="trigger" onClick={recoverFocus}>
        swap
      </button>
      <div ref={stageRef} {...(focusableStage ? { tabIndex: -1 } : {})}>
        {stage}
      </div>
    </>
  );
}

function mount(stage: ReactNode, focusableStage = false): void {
  act(() => root.render(<Harness stage={stage} focusableStage={focusableStage} />));
}

const recover = (): void => {
  const trigger = host.querySelector<HTMLButtonElement>('[data-testid="trigger"]')!;
  act(() => trigger.click());
};

describe("useFocusRecovery picks something focus() can actually land on", () => {
  it("skips a disabled button and takes the first enabled one", () => {
    mount(
      <>
        <button type="button" disabled>
          Sending…
        </button>
        <button type="button">Another round</button>
      </>,
    );
    recover();
    expect(document.activeElement?.textContent).toBe("Another round");
  });

  it("takes a link when the only button is disabled", () => {
    mount(
      <>
        <button type="button" disabled>
          Sending…
        </button>
        <a href="/progress">See your progress</a>
      </>,
    );
    recover();
    expect(document.activeElement?.tagName).toBe("A");
  });

  it("still takes the first control when nothing is disabled", () => {
    mount(
      <>
        <button type="button">Photograph</button>
        <button type="button">AI-generated</button>
      </>,
    );
    recover();
    expect(document.activeElement?.textContent).toBe("Photograph");
  });

  it("falls back to a focusable stage when the stage holds no control", () => {
    mount(<p className="muted">Dealing a round…</p>, true);
    recover();
    expect(document.activeElement).toBe(host.querySelector("div"));
  });

  it("leaves focus alone when there is nothing to move it to", () => {
    mount(<p className="muted">Dealing a round…</p>);
    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="trigger"]')!;
    trigger.focus();
    recover();
    expect(document.activeElement).toBe(trigger);
  });
});
