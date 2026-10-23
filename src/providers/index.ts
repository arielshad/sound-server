import type { Provider } from "../core/types.js";
import { freesound } from "./freesound.js";
import { linkedProviders } from "./linked.js";
import { openverse } from "./openverse.js";
import { packStoreProviders } from "./packstores.js";

/**
 * Every built-in provider, in the order results are reported. Originals come
 * before mirrors: when the same sound is found twice, de-duplication keeps the
 * copy from the source listed first (Freesound before Openverse).
 */
export const allProviders: Provider[] = [freesound, openverse, ...packStoreProviders, ...linkedProviders];
