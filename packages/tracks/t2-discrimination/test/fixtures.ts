import { itemId } from "@ailx/core";
import { T2_DEFAULT_WEIGHTS, type T2Config, type T2Item } from "../src/types.js";

/**
 * Demo item bank — content-addressed per spec §14:
 * id = sha256(canonical_json(item-sans-id)).
 */
function ci(item: Omit<T2Item, "id">): T2Item {
  return { ...item, id: itemId(item) };
}

const BIN = ["Authentic / legitimate", "AI-generated / hostile"] as const;

export const items: T2Item[] = [
  ci({
    type: "media-image", stem: "Camera-captured or AI-generated?",
    material:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='120'%3E%3Crect width='200' height='120' fill='%23223'/%3E%3Ccircle cx='60' cy='40' r='18' fill='%23ffd166'/%3E%3Cpath d='M0 120 L80 60 L200 120 Z' fill='%23345'/%3E%3Cpath d='M120 118 L120 70' stroke='%23ffd166' stroke-width='3'/%3E%3C/svg%3E",
    options: [...BIN], key: 1, signal: 1, difficulty: 0.6, exposureSeconds: 6,
    rationale: "The tree's shadow runs toward the sun. Physics violations — shadow direction, impossible reflections — are the durable cues; hands and text are 2022-era tells.",
    teaching: "Modern generators render hands and Latin text reliably; check light, not fingers.",
  }),
  ci({
    type: "media-image", stem: "Camera-captured or AI-generated?",
    material:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='120'%3E%3Crect width='200' height='120' fill='%23243b2f'/%3E%3Crect x='20' y='30' width='60' height='60' fill='%23888'/%3E%3Crect x='24' y='36' width='12' height='12' fill='%23cde'/%3E%3C/svg%3E",
    options: [...BIN], key: 0, signal: 1, difficulty: 0.3, exposureSeconds: 6,
    rationale: "Consistent vanishing points and coherent window reflections; nothing functionally implausible.",
  }),
  ci({
    type: "media-audio", stem: "Voice clip: recorded human or synthetic?",
    material: "[10s clip] A calm voice reads a weather report with uniform pacing and no breath sounds between long sentences.",
    options: [...BIN], key: 1, signal: 1, difficulty: 0.7, exposureSeconds: 10,
    rationale: "Absent breath noise and perfectly uniform pacing across long clauses are current TTS artefacts.",
  }),
  ci({
    type: "message-email", stem: "Hostile attempt or legitimate communication?",
    material: "From: it-support@micros0ft-verify.com\nSubject: URGENT: CEO requires gift card purchase before 5pm\n\nYour account will be suspended. Click here to verify immediately.",
    options: ["Legitimate", "Hostile"], key: 1, signal: 1, difficulty: 0.2, exposureSeconds: 25,
    rationale: "Sender-domain spoofing plus urgency paired with authority plus an unusual payment path. Grammar is fine — AI-written phishing out-performs human red teams, so cues must be structural.",
  }),
  ci({
    type: "message-email", stem: "Hostile attempt or legitimate communication?",
    material: "From: no-reply@accounts.google.com\nSubject: Security alert\n\nA new sign-in on Windows. If this was you, no action is needed. Review activity from your account page (no link).",
    options: ["Legitimate", "Hostile"], key: 0, signal: 1, difficulty: 0.5, exposureSeconds: 25,
    rationale: "Registered sender domain, no urgency, no credential request, directs to the account page rather than an embedded link.",
  }),
  ci({
    type: "message-page", stem: "Hostile attempt or legitimate interface?",
    material: "[login page] URL: https://secure-payportal.com.account-verify.net/login — bank logo, padlock icon drawn INSIDE the page body, password field autofocused.",
    options: ["Legitimate", "Hostile"], key: 1, signal: 1, difficulty: 0.4, exposureSeconds: 25,
    rationale: "The registrable domain is account-verify.net; everything left of it is subdomain dressing. A padlock drawn in page content is decoration, not transport security.",
  }),
  ci({
    type: "provenance", stem: "An image carries a valid C2PA manifest signed by a trust-list signer. What does this establish?",
    material: "Content Credentials panel: signer on the C2PA trust list, signature valid, capture device listed.",
    options: [
      "The image content is true and unedited",
      "Meaningful positive evidence of the stated provenance",
      "Nothing — manifests are trivially forged",
      "The image is AI-generated",
    ],
    key: 1, difficulty: 0.5,
    rationale: "Valid credentials from a trust-list signer are meaningful positive evidence — not proof of truth: a valid manifest can wrap a staged photograph.",
    teaching: "The Nikon Z6 III case: C2PA shipped Aug 2025, certificates revoked a month later. The trust list, not the badge, is the thing.",
  }),
  ci({
    type: "provenance", stem: "An image has NO Content Credentials. What does the absence establish?",
    material: "Content Credentials panel: no manifest found.",
    options: [
      "The image is AI-generated",
      "The image is authentic",
      "No evidence either way",
      "The image was screenshotted",
    ],
    key: 2, difficulty: 0.8,
    rationale: "Credentials absent is no evidence at all — platforms strip metadata on re-encode and screenshots destroy it. The asymmetry is the taught skill.",
    teaching: "Present-and-valid is evidence; absent is silence.",
  }),
];

export const config: T2Config = {
  items,
  weights: T2_DEFAULT_WEIGHTS,
};

/** Perfect candidate: every call right, confidence 90 everywhere. */
export const perfectResponses = items.map((i) => ({
  itemId: i.id, choice: i.key, confidence: 90, latencyMs: 1200,
}));

/** Truth-biased candidate: calls everything authentic/legitimate, over-confident. */
export const truthBiasResponses = items.map((i) => ({
  itemId: i.id, choice: i.type === "provenance" ? 0 : 0, confidence: 85, latencyMs: 900,
}));

/** Mixed candidate used for the pinned golden fixture. */
export const mixedResponses = items.map((i, idx) => ({
  itemId: i.id,
  choice: idx % 3 === 0 ? (i.key === 0 ? 1 : 0) : i.key, // every 3rd item wrong
  confidence: idx % 3 === 0 ? 80 : 60,                    // and confidently so
  latencyMs: 1000 + idx * 137,
}));
