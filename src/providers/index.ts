import type { Provider } from "../core/types.js";
import { bbc } from "./bbc.js";
import { bigsoundbank } from "./bigsoundbank.js";
import { blackoctopus } from "./blackoctopus.js";
import { ccmixter } from "./ccmixter.js";
import { curated } from "./curated.js";
import { freepacks } from "./freepacks.js";
import { freesound } from "./freesound.js";
import { freewavesamples } from "./freewavesamples.js";
import { functionloops } from "./functionloops.js";
import { ghosthack } from "./ghosthack.js";
import { internetarchive } from "./internetarchive.js";
import { kenney } from "./kenney.js";
import { linkedProviders } from "./linked.js";
import { mixkit } from "./mixkit.js";
import { opengameart } from "./opengameart.js";
import { openverse } from "./openverse.js";
import { orangefreesounds } from "./orangefreesounds.js";
import { packStoreProviders } from "./packstores.js";
import { sampleradar } from "./sampleradar.js";
import { soundbible } from "./soundbible.js";
import { strudel } from "./strudel.js";
import { wikimediacommons } from "./wikimediacommons.js";
import { zenodo } from "./zenodo.js";

/**
 * Every built-in provider, in the order results are reported. Originals come
 * before mirrors: when the same sound is found twice, de-duplication keeps the
 * copy from the source listed first (Freesound and Wikimedia before Openverse).
 */
export const allProviders: Provider[] = [
  freesound,
  wikimediacommons,
  ccmixter,
  internetarchive,
  bbc,
  strudel,
  sampleradar,
  curated,
  zenodo,
  kenney,
  freewavesamples,
  opengameart,
  soundbible,
  orangefreesounds,
  bigsoundbank,
  openverse,
  freepacks,
  ghosthack,
  blackoctopus,
  ...packStoreProviders,
  functionloops,
  mixkit,
  ...linkedProviders,
];
