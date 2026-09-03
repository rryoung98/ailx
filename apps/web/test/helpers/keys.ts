/**
 * Storage keys the app owns, in one place, so a test can assert that two of
 * them are DIFFERENT without importing a module that would drag a build mode
 * (and a Clerk stub, and a corpus) into a test that needs neither.
 *
 * Each is re-exported from its owning module, never re-spelled: a copy would
 * pass this file's own tests while the app wrote somewhere else.
 */
export { LOCAL_PRACTICE_KEY } from "@ailx/report";
export { ATTEMPT_KEY } from "@ailx/session";
