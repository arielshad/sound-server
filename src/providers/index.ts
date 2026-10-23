import type { Provider } from "../core/types.js";
import { freesound } from "./freesound.js";
import { freewavesamples } from "./freewavesamples.js";
import { linkedProviders } from "./linked.js";
import { mixkit } from "./mixkit.js";
import { opengameart } from "./opengameart.js";
import { openverse } from "./openverse.js";
import { orangefreesounds } from "./orangefreesounds.js";
import { packStoreProviders } from "./packstores.js";
import { soundbible } from "./soundbible.js";

/**
 * Every built-in provider, in the order results are reported. Originals come
 * before mirrors: when the same sound is found twice, de-duplication keeps the
 * copy from the source listed first (Freesound and Wikimedia before Openverse).
 */
export const allProviders: Provider[] = [
  freesound,
  freewavesamples,
  opengameart,
  soundbible,
  orangefreesounds,
  openverse,
  ...packStoreProviders,
  mixkit,
  ...linkedProviders,
];
