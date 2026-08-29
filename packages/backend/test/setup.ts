/**
 * Every backend test file that touched Postgres left its PGlite wasm heap
 * (~250MB and rising) alive until the worker died. Closing it when the file
 * finishes keeps a reused fork flat instead of accumulating one heap per file.
 */
import { afterAll } from "vitest";
import { closeDb } from "./helpers.js";

afterAll(closeDb);
