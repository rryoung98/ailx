import { describe, it, expect } from "vitest";
import handler from "../api/v1/models.js";
import { makeReq, makeRes } from "./helpers.js";

const PROD = "https://rryoung98.github.io";

describe("models catalog", () => {
  it("returns the three allowlisted models", async () => {
    const res = makeRes();
    handler(makeReq({ method: "GET", origin: PROD }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.map((m) => m.id)).toEqual([
      "openai/gpt-4.1-nano",
      "google/gemini-3.1-flash-image",
      "google/gemini-3.1-flash-lite-image",
    ]);
  });

  it("marks image models with image output modality", () => {
    const res = makeRes();
    handler(makeReq({ method: "GET", origin: PROD }), res);
    const images = res.body.data.filter((m) => m.architecture?.output_modalities?.includes("image"));
    expect(images).toHaveLength(2);
  });

  it("echoes localhost origins and falls back for others", () => {
    let res = makeRes();
    handler(makeReq({ method: "GET", origin: "http://localhost:3199" }), res);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3199");
    res = makeRes();
    handler(makeReq({ method: "GET", origin: "https://evil.example.com" }), res);
    expect(res.headers["access-control-allow-origin"]).toBe(PROD);
  });

  it("204s OPTIONS and 405s POST (previously unhandled)", () => {
    let res = makeRes();
    handler(makeReq({ method: "OPTIONS", origin: PROD }), res);
    expect(res.statusCode).toBe(204);
    res = makeRes();
    handler(makeReq({ method: "POST", origin: PROD }), res);
    expect(res.statusCode).toBe(405);
  });
});
