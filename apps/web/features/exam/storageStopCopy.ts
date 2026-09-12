/**
 * What the candidate is told when this browser will not store any more of
 * their run (TEN-208).
 *
 * Pure and framework-free, so the wording can be pinned by a test that mounts
 * nothing. The two branches share no sentence about consequences, because the
 * consequences are not the same: with a Foray service behind this build the
 * work is already somewhere that issues a score, and without one it exists in
 * this tab and nowhere else.
 */
export interface StorageStopCopy {
  readonly heading: string;
  readonly body: readonly string[];
  readonly reason: string;
  readonly retryLabel: string;
  readonly continueLabel: string;
  readonly clockNote: string;
  /** True when a Foray service is behind this build and holds the work too. */
  readonly mirrored: boolean;
}

/**
 * The banner that replaces the stop once the candidate has chosen to carry
 * on. It repeats the choice, because a banner that only says "quota
 * exceeded" reads as a new problem every time it reappears.
 */
export function carriedOnCopy(reason: string): string {
  return (
    "This browser has no room for the rest of your run, and you chose to carry on. " +
    `Nothing more is being written here. The browser said: ${reason}`
  );
}

export function storageStopCopy(opts: { mirrored: boolean; reason: string }): StorageStopCopy {
  const body = opts.mirrored
    ? [
        "This browser has no room left for your run, so nothing more can be saved here. Every entry, including the one that just failed, is going to the Foray service instead — that is the copy your score is computed from, so the work itself is not lost.",
        "What you lose by carrying on is the local copy: close this tab and you cannot pick the run up again in this browser. Clearing space now is the safe move. Your browser's site-data setting for this site is where the room is.",
      ]
    : [
        "This browser has no room left for your run, so nothing more can be saved. This build has no Foray service to send it to instead, so anything you do from here exists only until you close this tab.",
        "Clear space for this site in your browser's settings, then press Save it again. Carrying on without doing that means the rest of your run is not recorded anywhere.",
      ];
  return {
    heading: "This browser cannot save any more of your run.",
    body,
    reason: `What the browser said: ${opts.reason}`,
    retryLabel: "Save it again",
    continueLabel: opts.mirrored ? "Carry on without the local copy" : "Carry on anyway",
    clockNote: "Your track clock is held while this is on screen. It is not charged to you.",
    mirrored: opts.mirrored,
  };
}
