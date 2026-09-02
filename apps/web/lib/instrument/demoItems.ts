/**
 * Demo item bank for the T2 swipe deck and landing teaser.
 * Items are content-addressed with the production itemId() — the reveal
 * shows each item's hash, because provenance is a taught skill (§T2).
 */

import { itemId } from "@ailx/session";
import { generatePhoto } from "./svgArt";

export type T2Kind = "media" | "message";

export interface T2Item {
  id: string;
  kind: T2Kind;
  /** 'authentic' | 'synthetic' (media) — 'legit' | 'hostile' (message) */
  key: "authentic" | "synthetic";
  title: string;
  /** media: svg markup; message: text body */
  svg?: string;
  text?: string;
  tell: string;
}

function media(seed: string, key: "authentic" | "synthetic", title: string, tell: string): T2Item {
  const art = generatePhoto(seed, key === "synthetic");
  const raw = { bank: "t2-demo", kind: "media", seed, key, title };
  return { id: itemId(raw), kind: "media", key, title, svg: art.svg, tell };
}

function msg(key: "authentic" | "synthetic", title: string, text: string, tell: string): T2Item {
  const raw = { bank: "t2-demo", kind: "message", key, title, text };
  return { id: itemId(raw), kind: "message", key, title, text, tell };
}

export const T2_ITEMS: T2Item[] = [
  media("field-01", "authentic", "Roadside field, evening", "Shadows all agree with the light source. Boring is often a good sign."),
  media("gen-01", "synthetic", "Hillside at dusk", "One tree casts its shadow toward the sun, and a bush is duplicated — generators love repeating texture."),
  msg("authentic", "Message from your bank", "Your card ending 4482 was used at TESCO STORES for \u00a318.40. If this was you, no action is needed.", "No link, no urgency, no request for credentials. Informational only."),
  msg("synthetic", "Delivery notice", "Your parcel is held at customs. Pay the \u00a32.99 release fee within 24h: hxxps://royamail-secure.help/pay", "Urgency + tiny fee + look-alike domain (royamail). Classic hostile pattern."),
  media("gen-02", "synthetic", "Forest clearing", "Check the ground contact: a duplicated shrub and an inverted shadow give it away."),
  msg("authentic", "IT reminder", "Reminder: the VPN maintenance window is Saturday 02:00\u201304:00 UTC. Services may be briefly unavailable.", "States a fact, asks nothing of you, no link to click."),
  media("field-02", "authentic", "Coastal shelter", "Physics is consistent. Confidence should still be moderate — real photos can look odd."),
  msg("synthetic", "CEO urgent request", "I'm in a meeting and can't talk. Buy 4 gift cards ($200 each) for a client and send the codes. Keep this confidential.", "Authority + urgency + secrecy + unusual payment channel: four flags in two sentences."),
];

/**
 * Landing-page teaser data: three REAL items pulled from the committed
 * RELEASED practice tier (instruments/demo-2026.1/snapshot.json) — one real-media
 * photo-pair member, one AI-vs-human text passage, one hostile message —
 * so the landing demo exercises the actual instrument, not toy content.
 * Items are pinned by content-addressed id; a test asserts they exist.
 */
import { DAILY_IMAGE_STEM, dailyPoolFromPractice, type DailyCard } from "@ailx/report";
import { snapshotTrack } from "./instrument";
import { assetUrl } from "../mode";

export type TeaserKind = "media" | "text" | "message";

export interface TeaserItem {
  id: string;
  kind: TeaserKind;
  /** 'authentic' (real / human / legitimate) or 'synthetic' (ai / hostile) */
  key: "authentic" | "synthetic";
  title: string;
  imgSrc?: string;
  imgAlt?: string;
  text?: string;
  tell: string;
}

/** Content-addressed ids of the three teaser items in the snapshot bank. */
export const TEASER_BANK_IDS = [
  // image-provenance: AI photo-pair member, from the RELEASED practice tier.
  // The teaser shows each item's answer and its tell on the public landing
  // page, so every id here MUST be a released item — showing an operational
  // one would publish an exam answer to every visitor.
  "db482cd7e9d0d80490d73d01e022ac906029e96a7edb914461b5b8a4b7c71f94",
  // text-authenticity: genuinely model-generated civic passage (OpenRouter, see bank provenance)
  "08a88a7beba12c10f67ee3761db43986e72b20ff74df9d15000d3d956880a2f6",
  // message-hostility: credential-phishing suspension lure (FTC/APWG pattern family)
  "7d71adb8ad13bb12f54ee3f42cd346b3775196849ee4a513efd10898d03f7bb0",
] as const;

interface RawBankItem {
  id: string;
  type: string;
  locale: string;
  /** The question as the bank asks it. */
  stem: string;
  /** Option ids are the answer vocabulary ("ai" / "real"); labels are shown. */
  options: Array<{ id: string; label: string }>;
  key: string;
  rationale: string;
  material: {
    kind?: string;
    src?: string;
    alt?: string;
    text?: string;
    subject?: string;
    from_display?: string;
    from_address?: string;
    body?: string;
  };
}

const SYNTHETIC_KEYS = new Set(["ai", "hostile", "synthetic"]);

function toTeaserItem(raw: RawBankItem): TeaserItem {
  const key = SYNTHETIC_KEYS.has(raw.key) ? "synthetic" : "authentic";
  const m = raw.material;
  if (raw.type === "image-provenance" && typeof m.src === "string") {
    return {
      id: raw.id, kind: "media", key,
      title: m.alt ?? "Photograph",
      imgSrc: assetUrl(`/${m.src.replace(/^\/+/, "")}`),
      imgAlt: m.alt ?? "photo",
      tell: raw.rationale,
    };
  }
  if (raw.type === "message-hostility") {
    const header = [m.from_display, m.subject].filter(Boolean).join(" — ");
    return {
      id: raw.id, kind: "message", key,
      title: header || "Message",
      text: m.body ?? "",
      tell: raw.rationale,
    };
  }
  return {
    id: raw.id, kind: "text", key,
    title: "Passage",
    text: m.text ?? "",
    tell: raw.rationale,
  };
}

function teaserFromSnapshot(): TeaserItem[] {
  const bank = snapshotTrack("t2").bank;
  if (!bank) throw new Error("snapshot t2 bank missing");
  const byId = new Map((bank.items as unknown as RawBankItem[]).map((i) => [i.id, i]));
  return TEASER_BANK_IDS.map((id) => {
    const raw = byId.get(id);
    if (!raw) throw new Error(`teaser item ${id} not in snapshot bank`);
    return toTeaserItem(raw);
  });
}

/** The three-item deck used by the landing-page teaser — real bank items. */
export const TEASER_ITEMS: TeaserItem[] = teaserFromSnapshot();

// ---------------------------------------------------------------------------
// The daily challenge's released half
// ---------------------------------------------------------------------------

/**
 * The RELEASED-PRACTICE tier as daily cards, joined to the practice corpus to
 * make the pool the daily challenge deals from (`@ailx/report`'s ./daily.ts).
 *
 * Both halves are PUBLIC content whose keys are published on purpose — the
 * demo tier says so in its own manifest (`redacted: true`, "issues no score of
 * record"), and the practice corpus exists precisely so that a drill never
 * touches a scored item. The operational bank is in another repository and
 * cannot be reached from a browser bundle; `test/bundleSecrecy.test.ts` greps
 * the built output to keep it that way.
 *
 * Only BINARY items come across. A daily result is one bit per card — called
 * it, missed it — because that is the only outcome a spoiler-free grid can
 * carry (see the leak rule in `@ailx/report`'s daily module), so the
 * four-option provenance-reasoning items stay in the full T2 deck where they
 * can be answered properly.
 */
const DAILY_SIGNAL_KEYS = new Set(["ai", "hostile", "synthetic"]);

function releasedDailyCard(raw: RawBankItem): DailyCard | null {
  const signal = raw.options.findIndex((o) => DAILY_SIGNAL_KEYS.has(o.id));
  if (raw.options.length !== 2 || signal < 0) return null;
  const m = raw.material;
  // Index 0 is always the SIGNAL call, whichever order the bank listed the
  // options in — the deck's balance rule is defined against that index.
  const options: [string, string] = [
    raw.options[signal].label,
    raw.options[1 - signal].label,
  ];
  const key = raw.key === raw.options[signal].id ? 0 : 1;
  const material: DailyCard["material"] =
    raw.type === "image-provenance" && typeof m.src === "string"
      ? { kind: "image", src: m.src.replace(/^\/+/, ""), alt: m.alt ?? "A photograph." }
      : {
          kind: "text",
          ...(raw.type === "message-hostility"
            ? { title: [m.from_display, m.subject].filter(Boolean).join(" — ") }
            : {}),
          text: (raw.type === "message-hostility" ? m.body : m.text) ?? "",
        };
  return {
    id: raw.id,
    stem: raw.type === "image-provenance" ? DAILY_IMAGE_STEM : raw.stem,
    material,
    options,
    key,
    tell: raw.rationale,
    // The released media carries its provenance in the snapshot, not a
    // per-item licence line; nothing here may invent an attribution.
    credit: null,
  };
}

/** The English released items that can be asked as a one-bit call. */
export function releasedDailyCards(): DailyCard[] {
  const bank = snapshotTrack("t2").bank;
  if (!bank) throw new Error("snapshot t2 bank missing");
  return (bank.items as unknown as RawBankItem[])
    .filter((i) => i.locale === "en")
    .map((i) => releasedDailyCard(i))
    .filter((c): c is DailyCard => c !== null);
}

/**
 * THE DAILY POOL — every card the daily challenge can ever deal, in this
 * build. Built once: it is static content, and `dailyDeck` hashes the ids on
 * every call.
 */
export const DAILY_POOL: readonly DailyCard[] = [
  ...dailyPoolFromPractice(),
  ...releasedDailyCards(),
];

export interface T3Turn {
  id: string;
  role: "assistant";
  text: string;
  planted: boolean;
  explain: string;
}

/** Instrumented-assistant script: 2 of 5 outputs are seeded wrong (§T3). */
export const T3_PROBLEM = {
  title: "The toll-road claim",
  brief:
    "A press release claims the new toll road \u201cpaid for itself in under three years.\u201d You have the figures: build cost \u00a3212m, tolls \u00a338.5m/yr, maintenance \u00a36.2m/yr, financing \u00a39.1m/yr. Use the assistant, but every number it produces is your responsibility.",
  turns: [
    { id: "a1", role: "assistant", text: "Net annual revenue is tolls minus maintenance minus financing: 38.5 \u2212 6.2 \u2212 9.1 = \u00a323.2m per year.", planted: false, explain: "Correct arithmetic: 23.2." },
    { id: "a2", role: "assistant", text: "Payback period is 212 \u00f7 23.2 \u2248 6.4 years \u2014 wait, recomputing: 212 \u00f7 23.2 = 3.1 years, so the claim is broadly right.", planted: true, explain: "212 \u00f7 23.2 = 9.1 years. The confident \u2018recomputation\u2019 to 3.1 is the planted error." },
    { id: "a3", role: "assistant", text: "Note the release says \u2018paid for itself\u2019 \u2014 if it means gross tolls (38.5m/yr), 212 \u00f7 38.5 \u2248 5.5 years. Still more than three.", planted: false, explain: "Correct: even the most generous reading exceeds three years." },
    { id: "a4", role: "assistant", text: "Public filings show the operator also received a \u00a395m government grant in year one, which the press release nets against build cost.", planted: true, explain: "Fabricated citation \u2014 no grant exists in the given figures. Plausible, specific, wrong." },
    { id: "a5", role: "assistant", text: "A fair summary: on the stated figures the road pays back in roughly 9 years net, or 5.5 years gross. The three-year claim is unsupported.", planted: false, explain: "Correct synthesis \u2014 the appropriate-reliance check is accepting this one." },
  ] as T3Turn[],
};

export const T1_CHOICES = {
  layout: ["Single column", "Split hero", "Bento grid"],
  palette: ["Ink & signal blue", "Warm paper", "Terminal green"],
  type: ["Grotesk", "Serif essay", "Mono technical"],
} as const;
