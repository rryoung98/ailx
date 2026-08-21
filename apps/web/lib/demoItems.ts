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
 * instrument snapshot (instruments/2026.1/snapshot.json) — one real-media
 * photo-pair member, one AI-vs-human text passage, one hostile message —
 * so the landing demo exercises the actual instrument, not toy content.
 * Items are pinned by content-addressed id; a test asserts they exist.
 */
import { snapshotTrack } from "./instrument";

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
  // image-provenance: AI photo-pair member (FLUX.1 hedgehog vs real Commons hedgehogs)
  "d4b4c861ac359dce676210a00440bd409892857289c13d9969c366c6d4295e19",
  // text-authenticity: genuinely model-generated civic passage (OpenRouter, see bank provenance)
  "08a88a7beba12c10f67ee3761db43986e72b20ff74df9d15000d3d956880a2f6",
  // message-hostility: credential-phishing suspension lure (FTC/APWG pattern family)
  "7d71adb8ad13bb12f54ee3f42cd346b3775196849ee4a513efd10898d03f7bb0",
] as const;

interface RawBankItem {
  id: string;
  type: string;
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
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "/ailx";
    return {
      id: raw.id, kind: "media", key,
      title: m.alt ?? "Photograph",
      imgSrc: `${base}/${m.src.replace(/^\/+/, "")}`,
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
