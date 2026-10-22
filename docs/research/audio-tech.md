# sound-server: Audio Tech Research (taxonomy, analysis, semantic search, previews, licences, prior art)

_Researched 2026-10-22. npm versions checked with `npm view`. I ran hands-on experiments with Node 22.22 and ffmpeg 6.1 in a scratch dir (results below)._

---

## 0. Headline findings (read this first)

1. **Use Node 22 LTS as the baseline, not Node 20.** Node 20 reached EOL in April 2026, and the current versions of the key deps need Node 22 or later:
   `astro@7.4.2` (node >=22.23.4), `better-sqlite3@13.0.3` (>=22), `execa@10.2.0` (>=22), `@lancedb/lancedb@0.40.0` (>=22), `music-metadata@12.2.3` (>=22, ESM-only). The last music-metadata line that supports Node 18/20 is 11.x.
2. **essentia.js: avoid it in v1.** It is AGPL-3.0, the last npm release was 0.1.3 in 2022 and it is effectively unmaintained. Essentia's pretrained models are **CC BY-NC-ND** (non-commercial). Using AGPL code in a hosted service means you must offer the source of the whole service to network users. Commercial licences come from MTG/UPF on request.
3. **fluent-ffmpeg is deprecated.** v2.1.3 on npm is marked "no longer supported", and the README says it is deprecated and looking for maintainers. Spawn `ffmpeg` and `ffprobe` directly with `node:child_process` or `execa@10`, using a small typed wrapper of our own. ffprobe `-of json` together with the `ebur128`, `loudnorm`, `silencedetect` and `silenceremove` filters covers almost everything we need.
4. **music-metadata does NOT parse the WAV `acid` or `smpl` chunks.** I checked the 12.2.3 source: `WaveParser` handles only `LIST/INFO`, `fmt`, `fact`, `id3`, `data` and `bext`. `wavefile@11` reads `smpl`, `cue `, `bext` and `iXML` but not `acid`. → Write a small (~100 LOC) RIFF chunk walker for `acid` and `smpl`. These are high-value: the ACID flags carry an explicit **one-shot bit**, the root note, the beat count and the tempo.
5. **CLAP in Node works today.** `@huggingface/transformers@4.3.1` with `Xenova/clap-htsat-unfused` or `Xenova/larger_clap_music_and_speech` (both Apache-2.0) ran zero-shot classification on synthetic kick, hat, riser, zap and drum-loop clips and got **5/5 correct** (details in §3). Each clip took about 0.3–1.6 s on 4 CPU cores. Model weights are 160–330 MB quantised.
6. **web-audio-beat-detector does not work in plain Node.** It throws `Worker is not defined`, even with `node-web-audio-api`. **music-tempo** (MIT, pure JS) returned exactly 120.000 BPM on a synthetic loop in about 100 ms, but it throws on one-shots, so call it only on loop candidates.
7. **Looperman's ToS forbids scrapers, bots and ML training**, and acapella use is personal/non-commercial unless the uploader says otherwise. Treat it as "link out / manual" only, or skip it. This affects the sources plan.
8. **wavesurfer.js is now v8** (8.0.3, BSD-3-Clause, released Oct 2026). The public API is unchanged from v7 for most uses, and `@wavesurfer/react@1.0.12` exists.

---

## 1. Taxonomy

### 1.1 How others do it

| System | Structure | Notes |
|---|---|---|
| **Splice** | Facets: *Instrument* (drums, vocals, percussion, bass, synth, FX…), *Genre*, *Label*, plus **Format filter: Loops vs One-shots**, BPM (range or exact), Key (root + maj/min), free tags | Special tags like "tops" (hat/shaker/tamb/clap loops), "grooves" (full drum loops), "risers", "downers". Creator guidelines: two top-level audio folders, **LOOPS** and **ONE SHOTS**. Percussion is separate from drums. |
| **Loopcloud** | AI auto-tagging into instrument tags (Drum, …) + Genres/sub-genres + user/label tags; DRUM plugin auto-tags drum type | Full tag list is not published |
| **Freesound Broad Sound Taxonomy (BST)**, mandatory on upload since Apr 2025, back-filled by a classifier for older sounds | 5 top / 23 sub: **Music** (m-sp solo percussion, m-si solo instrument, m-m multiple, m-other); **Instrument samples** (is-p percussion, is-s string, is-w wind, is-k piano/keys, is-e synths/electronic, is-other); **Speech** (sp-s, sp-c, sp-p processed/synthetic, sp-other); **Sound effects** (fx-o objects/house, fx-v vehicles, fx-m machines, fx-h human, fx-a animals, fx-n natural/explosions, fx-ex experimental, fx-el electronic/design, fx-other); **Soundscapes** (ss-n, ss-i, ss-u, ss-s, ss-other) | Useful as a **prior**: `is-p` → drums/perc one-shot, `m-sp` → drum loop, `fx-el` → zaps/risers/glitch, `sp-*` → vocal/spoken. Too coarse for production use on its own. |
| **Freesound analysis descriptors** (APIv2, Essentia-derived; some from AudioCommons) | `bpm`, `tonality` ("C minor") + `tonality_confidence`, **`loopable`** (bool), **`single_event`** (bool, loudness-based), `note_name`/`note_midi`/`note_confidence`, `loudness` (LUFS EBU R128) | Older docs/clients use the `ac_` prefix (`ac_tempo`, `ac_loop`, `ac_single_event`, `ac_note_midi`…). Check the exact field names against the live API. These fields fill BPM, key and form for Freesound results for free. |
| **Audio Commons Ontology** (ISWC 2018) | FRBR-based, SKOS for taxonomies, interoperable with the Music Ontology; designed for repositories of instrument samples and loops | Good conceptual model (Work/Manifestation/Item ≈ sound / format / file). There is no ready-made category list to copy. The **AudioCommons ac-mediator** (Freesound + Jamendo + Europeana) is the closest prior art for an aggregator; it is stale (2017). |
| **AudioSet ontology** (Google, 632 classes) | Music → Musical instrument → Percussion → Drum kit → Bass drum / Snare drum / Hi-hat / Cymbal(Crash)…, Synthesizer, Sampler; Sounds of things; Human sounds; Natural; "Sound effect"… | Good for **foley/SFX** labels and CLAP prompt wording, because CLAP was trained on AudioSet-like captions. Weak for producer terms such as riser, 808, top loop and chop. |
| **NSynth instrument families** | bass, brass, flute, guitar, keyboard, mallet, organ, reed, string, synth_lead, vocal | Reasonable set for instrument one-shots and multisamples |

### 1.2 Recommended vocabulary (v1)

The key design choice is to keep the facets **orthogonal**, as Splice does: `category` (what it is) × `form` (one-shot/loop/…) × `genre[]` × `character[]` (free descriptors) × musical attributes.

```
form: one-shot | loop | phrase (non-looping musical phrase, acapella, fill) | multisample | ambience | unknown

category (dot-path, 2–3 levels; stable ids; i18n labels separate):
drums
  drums.kick            (aliases: kick, bd, bass drum, kik, kck, 909 kick)
  drums.snare           (snare, sd, snr, rimshot→drums.perc.rim? keep rim separate)
  drums.clap            (clap, clp, cp, handclap)
  drums.snap            (snap, finger snap)
  drums.hat.closed      (hihat/hi-hat/hat/hh + closed/chh/ch)
  drums.hat.open        (ohh/oh/open hat)
  drums.cymbal.crash    (crash)
  drums.cymbal.ride     (ride)
  drums.cymbal.other    (china, splash, cymbal)
  drums.tom             (tom, floor tom, rack tom)
  drums.perc            (perc, shaker, tambourine, conga, bongo, cowbell, rim, block, clave, triangle, guiro…) → optional 3rd level
  drums.fill            (fill, roll, snare roll, build)
  drums.kit/break       (break, breakbeat, amen) [form usually loop]
  drums.tops            (top loop, tops, hat loop) [form loop]
bass
  bass.808              (808, 808 bass, boom, tr-808 kick-bass)
  bass.sub              (sub, sub bass)
  bass.synth / bass.electric / bass.acoustic(upright)
vocals
  vocals.acapella  vocals.chop  vocals.oneshot (hey/yeah/shout/adlib)  vocals.phrase  vocals.spoken (spoken word, speech, dialogue)  vocals.fx (vocoder, processed)  vocals.choir
fx
  fx.riser (uplifter, build, rise, swell)   fx.downlifter (downer, fall, drop sweep)
  fx.impact (hit, boom, sub drop, slam, braam)   fx.sweep (white noise sweep, whoosh→fx.transition)
  fx.zap (laser, zap, pew, blip?)   fx.noise (white/pink noise, static)   fx.glitch (glitch, stutter, bitcrush)
  fx.transition (whoosh, swoosh, reverse cymbal, tape stop)   fx.reverse   fx.texture (vinyl crackle, atmos/drone→ambience)
  fx.ui / fx.game (coin, power-up, 8-bit)  ← useful for chiptune/game agents
foley       foley.footsteps / foley.object / foley.cloth / foley.door / foley.water / foley.body … (map AudioSet/BST fx-o, fx-h, fx-n)
ambience    ambience.nature / ambience.urban / ambience.indoor / ambience.drone (BST ss-*)
instruments
  keys.piano  keys.epiano(rhodes/wurli)  keys.organ  keys.other
  guitar.acoustic  guitar.electric  guitar.other(banjo, ukulele, sitar…)
  synth.pad  synth.lead  synth.pluck  synth.arp  synth.stab/chord  synth.bass→bass.synth  synth.other
  strings (violin, cello, orchestral, pizzicato)  brass (trumpet, horn, trombone)  woodwind (flute, sax, clarinet)
  mallets (marimba, vibraphone, bells, glockenspiel, kalimba)  world (koto, sitar, tabla…)
  multisample (form=multisample; per-note sets, SFZ/Decent Sampler packs)
music       music.full / music.stem (non-sample music; low priority)
other / unknown
```

Musical attributes on every sample: `bpm`, `bpmSource`, `bpmConfidence`, `key` (e.g. `Am` / `F#` with `mode`), `rootNote` (MIDI, for one-shots), `bars`, `beats`, `timeSignature`, `durationSec`, `sampleRate`, `bitDepth`, `channels`, `lufsI`, `truePeakDb`, `loopable`, `startsOnTransient`.

### 1.3 Mapping free-text → categories

Use a **layered, explainable pipeline**. Every assignment carries `{category, form, confidence, evidence[]}` so that agents and the UI can see why.

1. **Source-native signals (highest prior).** Freesound BST code + `single_event`/`loopable`/`bpm`/`tonality`; Wikimedia Commons categories; Internet Archive collection/subject; pack folder paths. Sample packs encode category in their paths, e.g. `Drums/Kicks/…` and `One Shots/FX/`.
2. **Embedded file metadata.**
   - The ACID `acid` chunk flags (bit0 = one-shot, bit1 = root note valid, bit2 = stretch) give an authoritative one-shot vs loop answer and BPM.
   - `smpl` chunk loops → loopable / multisample; `MIDIUnityNote` → root note.
   - Apple Loops `basc` chunk (AIFF/CAF).
   - ID3/INFO genre and comments.
3. **Tokenised keyword rules** over filename/title (weight 3), tags (2), pack/folder (2) and description (1):
   - Normalise: lowercase, split camelCase/`_`/`-`/digits, strip BPM/key tokens into attributes using regexes such as `(\d{2,3})\s?bpm` and key patterns like `\b([A-G][#b]?)\s?(maj|min|m|minor|major)?\b`, guarded against false positives like "a", "e" and "d" in words.
   - Expand abbreviations (`bd`, `sd`, `hh`, `oh`, `ch`, `cp`, `perc`, `fx`, `sfx`, `vox`).
   - Keep an **alias dictionary in YAML** (one file per top-level category), versioned and unit-tested against a fixture list of real filenames.
   - Add **precedence and compound rules**: `808` + `loop` → `bass.808` + loop; `kick`+`snare`+`hat` or `drum loop`/`beat`/`groove`/`break` → `drums.kit`, loop; `snare roll` → `drums.fill`; `vocal` + `chop` → `vocals.chop`; `reverse cymbal` → `fx.transition`, not `drums.cymbal`; `riser`/`uplifter` beats `synth`; `laser`/`zap`/`pew` → `fx.zap`.
   - Use negative tokens for false friends: "kick" in "kickstarter", "hat" in "chat"/"what" (use whole-token match only), "clap" in "thunderclap" → fx.impact/foley.
4. **Signal heuristics for `form`.**
   - duration < ~2.5 s and no detected periodicity → one-shot.
   - Loop → duration ≈ n × bar length at a plausible BPM (|dur − k·240/bpm| < 1–2 %, k ∈ {1,2,4,8,16}), plus a low-silence tail and an energetic start.
   - `silencedetect` tail ratio helps too.
5. **Optional ML (v1.5/v2).** CLAP zero-shot over category prompts, run only when rules are low-confidence or disagree. Better still, use **nearest-centroid on CLAP audio embeddings** built from a few hundred hand-labelled seed samples per class (the approach used in recent drum-transcription data work). Fuse the results: `final = argmax(w_meta·meta + w_rule·rule + w_ml·ml)`, with the evidence recorded.

---

## 2. Audio analysis in Node (2026 status)

| Package | Version / licence / last publish | Verdict |
|---|---|---|
| **ffmpeg / ffprobe** (system binary) | 6.x–8.x, LGPL/GPL depending on build | **Core.** Decode anything → PCM (`-f f32le -ac 1 -ar 22050 pipe:1`). Use `ffprobe -of json` for duration, codec, sample rate and bit depth. `ebur128=peak=true` gives I-LUFS, LRA and true peak; it took **0.23 s for 8 s of stereo**. `silencedetect`/`silenceremove` handle trimming and `loudnorm` handles previews. |
| fluent-ffmpeg | 2.1.3, MIT, **deprecated** | Don't use. Write our own ~150-LOC wrapper on `execa@10.2.0` (MIT, node>=22) or `child_process.spawn`. |
| ffmpeg-static | 5.3.0, **GPL-3.0-or-later** binary | OK as a dev/CLI convenience. Prefer system ffmpeg in Docker. Shipping a GPL ffmpeg inside a distributed CLI brings GPL source-offer obligations for that binary; a hosted-only service is fine. |
| @ffmpeg/ffmpeg (wasm) | 0.12.15, MIT, Apr 2025 | Browser-oriented and slow; not needed server-side. |
| **music-metadata** | 12.2.3, MIT, Oct 2026, ESM, **node>=22** | **Use** for tags (ID3, Vorbis, RIFF INFO, bext, iXML via native), format and duration across MP3/FLAC/OGG/M4A/AIFF/WAV. It does **not** read `acid`/`smpl`. |
| **wavefile** | 11.0.0, MIT, 2022 (stable, unmaintained) | Optional. Reads `smpl`/`cue`/`bext`/`iXML` and converts bit depth and sample rate. A custom chunk walker is simpler and has no dependency. |
| **Custom RIFF walker** | — | **Write it.** `acid` layout (24 bytes, little-endian): `u32 flags` (0x01 one-shot, 0x02 root-note-set, 0x04 stretch, 0x08 disk-based), `u16 rootNote`, `u16 ?`, `f32 ?`, `u32 numBeats`, `u16 meterDenom`, `u16 meterNum`, `f32 tempo`. `smpl`: manufacturer, product, samplePeriod, `MIDIUnityNote`, pitchFraction, SMPTE×2, `numLoops`, samplerData, then loops {cueId, type, start, end, fraction, playCount}. Also read `LIST/INFO` (`IGNR`, `ICMT`, `IKEY` tags; some packs put BPM there) and `bext` description. |
| **music-tempo** | 1.0.3, MIT, 2022 (stable) | **Use for loops.** Pure JS (Dixon-style beat induction). Got exactly 120.000 BPM on the test loop in about 100 ms. It throws on one-shots and silence, so wrap it in try/catch. Fold results to the 70–180 range and resolve half/double tempo with a filename hint and a bar-length duration check. |
| web-audio-beat-detector | 8.2.39, MIT, actively published | **Does not run in Node.** It needs `Worker` and fails even with `node-web-audio-api@2.2.0`. Browser only. |
| realtime-bpm-analyzer | 5.0.16, Apache-2.0, Oct 2026 | Browser/AudioWorklet oriented. Could be an option in the web UI, but not needed. |
| **meyda** | 5.6.3, MIT, Apr 2024 | **Use** for frame features (RMS envelope, spectral centroid, flatness, ZCR, **chroma**, MFCC). Feeds onset/one-shot heuristics, brightness tags and **key detection**: chroma with Krumhansl-Schmuckler or Temperley profiles is about 60 LOC and MIT-clean. |
| **pitchy** | 4.1.0, MIT | **Use** for the root note of tonal one-shots (McLeod pitch method), e.g. 808s, plucks and stabs. Take the median pitch over the sustain frames. |
| pitchfinder | 2.3.4, GPL-3 | Avoid (licence). |
| essentia.js | 0.1.3, **AGPL-3.0**, 2022 | Best-quality algorithms (KeyExtractor, RhythmExtractor2013, LoopBpmEstimator, Loudness), but AGPL + stale + CC BY-NC-ND models. Consider it **only** if sound-server itself is AGPL/open source, or in an isolated optional worker. Freesound already exposes Essentia-computed BPM/key/loopable for its own sounds. |
| aubiojs | 0.2.1, no licence field (aubio is **GPL-3**), 2022 | Avoid. |
| keyfinder-js | 1.0.3, no licence, 2022 | Avoid. libKeyFinder is GPL. |
| ebur128-wasm | 3.0.0, Apache-2.0, 2023 | Pure-JS-side loudness if we want to avoid a second ffmpeg pass. Fine, but ffmpeg `ebur128` is simpler. |
| @spotify/basic-pitch | 1.0.1, Apache-2.0 | Polyphonic audio → MIDI (TF.js). Later: "give me the MIDI of this melodic loop" for agents. |
| node-web-audio-api | 2.2.0, BSD-3, Aug 2026 | Rust-backed Web Audio for Node. Useful if we ever need OfflineAudioContext rendering. Not needed for v1. |

**Recommended v1 analysis pipeline** (one worker job per downloaded file, idempotent, cached by content hash):

```
ffprobe -of json            → container, codec, sr, bitDepth, channels, duration
music-metadata + RIFF walker→ tags, ACID (one-shot flag, bpm, beats, root), smpl (loops, root), INFO
ffmpeg -> f32le mono 22.05k → in-memory Float32Array
  ├─ ebur128 (ffmpeg, same decode or 2nd pass) → LUFS-I, LRA, true peak
  ├─ silencedetect → lead/trail silence → trim points
  ├─ meyda frames → RMS envelope (attack time, decay, transient at start), centroid, chroma
  ├─ form classifier: ACID flag > source flag (Freesound single_event/loopable) > duration+envelope+bar-length check
  ├─ if loop: music-tempo → bpm (+ halving/doubling resolve), bars = round(dur*bpm/240)
  ├─ if tonal & long enough: chroma key (K-S profiles) → key + confidence
  └─ if tonal one-shot: pitchy median f0 → rootNote
```

Performance: ffmpeg decode + ebur128 is about 0.2 s for an 8 s file. JS features add about 0.1–0.3 s. A 4-core box can analyse roughly 10–20 samples/s, which is plenty.

Keep provenance per field: `bpmSource: "acid"|"source"|"filename"|"analysis"`. Agents should trust `acid`/`source` over `analysis`, and the filename over analysis when they disagree by exactly ×2 or ×0.5.

---

## 3. Semantic / audio search (CLAP)

**What works in Node (verified):** `@huggingface/transformers@4.3.1` (Apache-2.0; deps `onnxruntime-node@1.30.0`, `sharp`) supports `zero-shot-audio-classification`, `ClapTextModelWithProjection` and `ClapAudioModelWithProjection`, with 512-dim embeddings.

Experiment (synthetic test clips; `dtype: 'q8'`; 4 vCPU; labels = kick drum, snare drum, hi-hat, laser zap sound effect, riser sweep, drum loop, vocal; template "This is a sound of {}."):

| clip | clap-htsat-unfused (Apache-2.0) | larger_clap_music_and_speech (Apache-2.0) |
|---|---|---|
| sine-decay kick | kick 0.98 (1.3 s) | kick 1.00 (1.6 s) |
| HP-noise hat | hi-hat 0.96 (0.34 s) | hi-hat 1.00 (0.6 s) |
| sine-sweep riser (4 s) | riser 0.64 / zap 0.36 | riser 0.97 |
| down-chirp zap | zap 0.99 | zap 0.89 |
| 8 s 120 BPM loop | drum loop 0.98 (6.4 s) | drum loop 0.99 (7.1 s) |

- Model load took 3–9 s. The cached quantised files are about 160 MB (`model_quantized.onnx`) + 127 MB (text) for unfused, and 205 MB + 127 MB for larger_clap_music_and_speech. For embedding-only use, load the separate audio/text models, not the combined one.
- The ~6 s on the 8 s clip is mostly the JS mel feature extractor. Truncate or centre-crop to about 5–7 s for embedding, or run it in a worker thread.
- **Install gotcha:** `onnxruntime-node`'s postinstall downloads CUDA artefacts, and in our sandbox it failed with ECONNRESET. Set `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` (CPU binaries ship in the package) in Docker/CI.
- Other models: **LAION larger_clap_music** (Apache-2.0) is best for music. **MS CLAP 2023** (`msclap`, MIT code) has no official ONNX, so you would have to export it yourself; not worth it. Zero-shot ONNX vs PyTorch score drift has been reported, so calibrate thresholds on our own data.

**Vector store options:**

| Option | Version/licence | Fit |
|---|---|---|
| **sqlite-vec** | 0.1.9, MIT/Apache-2.0, pre-1.0 | Best fit if the metadata DB is SQLite (`better-sqlite3@13`). Brute-force `vec0` virtual table handles 100k × 512-d fine (tens of ms). |
| pgvector (`pgvector@0.3.0` client) | MIT | Choose this if we go Postgres for multi-user hosting. HNSW is mature. |
| @lancedb/lancedb | 0.40.0, Apache-2.0, node>=22 | Embedded columnar + ANN. Good for large local corpora, but heavier and a second store. |
| usearch | 2.26.5, Apache-2.0 | In-process HNSW. Fast, but you manage persistence yourself. |
| @electric-sql/pglite | 0.5.11 | Postgres-in-WASM with pgvector. Interesting for a single-binary local mode. |

**Is it worth it?**
- **v1:** No embedding index. Text search over normalised metadata (SQLite FTS5) plus facets (category/form/bpm/key/licence) gives agents most of the value.
- **v1:** Make the analysis pipeline embedding-ready by storing a content hash and a decoded mono-PCM cache key.
- **v1.5 (cheap win):** CLAP zero-shot only as a classifier fallback for low-confidence categories, behind a feature flag (`SOUND_SERVER_ML=1`), with lazy model download.
- **v2:** Store CLAP audio embeddings for every *downloaded/cached* sample in sqlite-vec. This enables `find_similar(sampleId)`, text→audio re-ranking of federated results ("dark gritty 808 with long tail"), and dedup across sources via cosine > 0.98 plus a duration match. You can't embed remote results without downloading previews. Embedding Freesound previews (MP3/OGG HQ preview, no OAuth needed) on demand is feasible.

---

## 4. Transcoding & previews

- **Canonical storage:** keep the original file untouched, using a content-addressed path. Offer a **normalised export** on request: WAV PCM 24-bit (or the source bit depth if lower) at 44.1 kHz (or 48 kHz on request), via `-c:a pcm_s24le -ar 44100`. Use the soxr resampler, `-af aresample=resampler=soxr`, if the build has it. Keep stereo/mono as in the source.
- **Previews:**
  - **MP3 128–192 kbps CBR** (universal), plus optionally **Opus 96 kbps in Ogg/WebM** (smaller).
  - Generate them with loudness normalisation for *previews only*: `loudnorm=I=-16:TP=-1.5:LRA=11`, two-pass for accuracy. For short one-shots, use peak normalisation to about −1 dBTP instead, because integrated loudness is unreliable on clips under 400 ms.
  - Trim leading silence on previews only. Never trim loops: it breaks bar alignment.
  - `silenceremove=start_periods=1:start_threshold=-60dB` removes leading silence; use `areverse` around it for the tail.
- **Waveform peaks:**
  - **Simplest v1:** compute min/max peaks in Node from the same f32le decode used for analysis (e.g. 800–2000 buckets, normalised −1..1, 2 decimals) and store them as JSON next to the sample. wavesurfer.js v7/v8 accepts precomputed `peaks` + `duration`, so the browser doesn't decode the whole file.
  - **BBC audiowaveform** (C++ CLI, **GPL-3.0**, v1.10.x, development moved to Codeberg; .deb/.rpm/brew/Docker) produces `.dat`/`.json`/PNG. It is fine as an external process. Use it only for large, long files.
  - `waveform-data@4.5.2` (LGPL-3.0) reads its format. `peaks.js@4.0.0` (LGPL-3.0) is the BBC player. wavesurfer is the better choice for us.
- **Web UI player:** **wavesurfer.js 8.0.3** (BSD-3-Clause). v8 cleans up teardown and leaks, and `destroy()` is now final. Use the Regions plugin for loop-point display and Spectrogram as an option, plus `@wavesurfer/react@1.0.12` if React islands are used in Astro. Precomputed peaks keep long lists fast. Lazily create instances only on hover/visibility.
- **PNG waveforms for agents/MCP:** an MCP tool can return a small PNG waveform or spectrogram as an image content block. Generate it with `ffmpeg -filter_complex showwavespic=s=800x120` or `showspectrumpic`, with no extra dependency.

---

## 5. Licence handling

### 5.1 Identifier scheme

Use **SPDX ids where they exist**; all of these are in `spdx-license-ids@3.0.24`. Use `LicenseRef-*` for the rest (SPDX convention):

| Id | Commercial release? | Attribution? | Notes |
|---|---|---|---|
| `CC0-1.0` | yes | no (courtesy credit optional) | Freesound default option |
| `CC-PDM-1.0` (Public Domain Mark) | yes | no | Wikimedia/IA public-domain items |
| `CC-BY-4.0`, `CC-BY-3.0` | yes | **required** | |
| `CC-BY-SA-4.0`/`3.0` | yes, but **ShareAlike**: the derivative must be CC BY-SA | required | Usually unacceptable for a commercial track. Flag it as `copyleft`. Common on Wikimedia Commons. |
| `CC-BY-NC-4.0`/`3.0` | **no** | required | Freesound BY-NC |
| `CC-BY-ND-*`, `CC-BY-NC-ND-*` | **no derivatives**, so unusable for sampling | — | Mark `usableForSampling=false` |
| `CC-BY-NC-SA-*` | no | required | |
| `LicenseRef-CC-Sampling-Plus-1.0` (no SPDX id; retired by CC in 2011) | Yes, for sampling/transformation, but **cannot be used in advertising** for anything other than the new work. Freesound interprets it as roughly BY-NC plus no ads; be conservative and say `commercial: "restricted"`. | required | Legacy Freesound sounds |
| `LicenseRef-Looperman-Loop` | yes in derivative works, royalty-free, no attribution; no standalone redistribution | no | ToS forbids scraping/ML. See §0.7. |
| `LicenseRef-Looperman-Acapella` | **personal/non-commercial unless the uploader states otherwise** (credit often required) | per uploader | Requires reading the uploader's terms |
| `LicenseRef-Royalty-Free-<source>` | per source terms | per source | Commercial packs/vendors |
| `LicenseRef-Unknown` | **treat as no** | — | IA items without `licenseurl` |

Source mapping hints:
- Freesound `license` URL → id (map the 3.0/4.0 URL variants).
- IA `metadata.licenseurl` (often CC URLs).
- Wikimedia Commons `extmetadata.LicenseShortName` / `License` / `AttributionRequired` / `Artist` / `Credit`.
- Normalise via URL → id table.

### 5.2 Machine-readable usage verdict

This is what an agent needs; compute it, don't make the agent parse licences:

```json
"license": {
  "id": "CC-BY-4.0", "name": "Creative Commons Attribution 4.0", "url": "https://creativecommons.org/licenses/by/4.0/",
  "commercialUse": "allowed" | "restricted" | "forbidden" | "unknown",
  "derivativesAllowed": true,
  "attributionRequired": true,
  "shareAlike": false,
  "noAdvertising": false,
  "redistributionAsIs": "allowed" | "forbidden" | "unknown",
  "aiTrainingAllowed": "unknown" | "forbidden",
  "verdict": { "commercialRelease": "yes" | "yes-with-attribution" | "no" | "check", "reasons": ["…"] },
  "attributionText": "\"Kick 01\" by jdoe (https://freesound.org/s/12345/) — CC BY 4.0",
  "sourceTermsUrl": "…", "retrievedAt": "2026-10-22T…Z"
}
```

- Search/MCP filters: `commercialSafe=true` (CC0, PDM, CC-BY, royalty-free with derivatives) and `noAttribution=true` (CC0/PDM/Looperman loops).
- Default agent search should be **commercial-safe**.
- Always disclaim "not legal advice". Snapshot the licence at download time, because uploaders can change licences later and Freesound has done Sampling+ migrations.

### 5.3 Attribution files

- On every download, maintain alongside it (in the target folder or the project dir):
  - `ATTRIBUTION.md`: human-readable, grouped by licence, TASL format (Title, Author, Source, Licence), in Freesound's suggested credit-line style.
  - `credits.json`: machine-readable, one entry per file, with sha256, source id/url, licence object above and download timestamp.
  - Optionally `CREDITS.txt` for release liner notes.
- Make writes idempotent: merge by `source:id`.
- Add a CLI/MCP tool `credits(projectDir)` that regenerates the files from `credits.json` and prints a short "liner notes" string.
- Also include the licence in the downloaded filename suffix or the sidecar `<file>.json` so it travels with the file.

---

## 6. Prior art: what to learn or reuse

**Aggregators / sample browsers**
- **AudioCommons ac-mediator** (GitHub `AudioCommons/ac-mediator`, ~2017): a federated search across Freesound, Jamendo and Europeana with a unified schema and async aggregated responses (`collect_url`). Useful design reference: async fan-out with a response-collection endpoint, and per-provider "service descriptions". It also had a web front end (MuSST). Stale, so don't reuse the code.
- **Freesound APIv2**: text and content-based search, filters on the analysis descriptors (`bpm`, `tonality`, `loopable`, `single_event`, `note_midi`, `loudness`) and BST category. HQ previews are downloadable with an API key; originals need OAuth2. Their WAC-2025 paper describes the recent metadata/content-search updates.
- **AudioStellar** (open source, GitLab `ayrsd/audiostellar`, C++/openFrameworks + Python, on Flathub): a 2-D timbre map of a sample library via ML. Inspiration for a v2 "similarity map" in the web UI using UMAP over CLAP embeddings.
- **SampleCat** (GPL, Linux sample manager): classic local-library browser (tags, waveform, Jack). UI ideas only; GPL code.
- **Sononym** (commercial): ML similarity browser. Product reference for "find similar" and category auto-detection. **XO** (XLN, commercial): drum one-shot map + sequencer. Reference for drum-specific UX: kick/snare/hat lanes, "similar sound" swap. **SampleSorter AI** (commercial plugin): local 2-D map.
- Research: Pampalk et al. DAFx 2004 (hierarchical drum-sample organisation); SampleMatch (2022) used 63k drum one-shots in 6 classes {kick, snare, hi-hat, ride, crash, toms} from filename labels, which validates filename-keyword labelling for drums.

**Freesound MCP servers (consumers/competitors; all small community projects)**
- `johnkimdw/freesound-mcp-server` (Python, `search_sounds`)
- `MuShan-bit/freesound-mcp` (Node; search with duration/licence filters, download by id)
- `timjrobinson/FreesoundMCPServer` (Node; `get_sound_analysis` exposes descriptors; Claude Code `claude mcp add` setup)

Lesson: they are thin single-source wrappers. sound-server's differentiators are multi-source search, normalised categories/form/BPM/key, licence verdicts, local caching, credits files and analysis.

**Music-generation MCP servers (likely consumers of sound-server)**
- **ahujasid/ableton-mcp** (Python; Live Remote Script socket + MCP; tracks, clips, instruments/effects, transport). Consumer flow: sound-server downloads a WAV → agent loads it into a Simpler/Drum Rack slot.
- **Strudel MCPs:** `@williamzujkowski/strudel-mcp-server` (npm, Playwright-driven Strudel.cc, 50+ tools, experimental); `takeachangs/strudel-mcp` (pattern parse/generate, no browser); `mcp-strudel` (Strudel ↔ MIDI, pairs with ableton-mcp). Strudel loads samples by URL/sample maps (`samples({...})`), so sound-server should be able to **emit a Strudel sample map JSON** (`{ bd: [url…], sd: [...] }`) and serve files over HTTP with CORS.
- **REAPER:** `xDarkzx/Reaper-MCP` (Apache-2.0, ~150–170 tools, includes a loop-library pipeline that picks loops by BPM/key), `TwelveTake-Studios/reaper-mcp`.
- Others: FL Studio (`ae5n/fl-mcp`), Bitwig, Logic Pro (AUv3 MIDI bridge) community MCPs.
- Consumer needs: absolute local file paths, `bpm`/`key`/`bars`/`rootNote` for warping and tuning, consistent sample format (WAV 44.1/24), and licence verdicts.

**Output formats worth emitting for consumers**
- A plain folder kit + `kit.json`
- Strudel sample map
- A simple **SFZ** (for multisamples/drum kits; trivial text format, opens in sfizz/Sforzando/DecentSampler-adjacent tools)
- **Decent Sampler `.dspreset`** (XML), later
- A drum kit mapping using GM drum notes (kick 36, snare 38, clap 39, closed hat 42, open hat 46, crash 49, ride 51, toms 41/43/45/47/48/50), so MIDI-generating agents can map directly

---

## 7. Recommendations: v1 vs later

**v1 (ship)**
- Runtime: Node **22 LTS** (or 24), ESM, TypeScript, `hono@4.13.13`, `@modelcontextprotocol/sdk@1.32.1`, `zod@4`, `astro@7` (needs node >=22.23.4).
- Storage: SQLite via `better-sqlite3@13` with **FTS5** for text search; content-addressed file cache.
- Taxonomy: the dot-path vocabulary above, with orthogonal `form` and `genre[]`/`character[]`. YAML alias rules with tests. Source-native priors (Freesound BST + analysis fields). ACID/smpl metadata.
- Analysis: system **ffmpeg/ffprobe** through our own `execa` wrapper (no fluent-ffmpeg); **music-metadata 12**; custom **RIFF acid/smpl walker**; **music-tempo** for loop BPM; **meyda** (envelope, chroma → K-S key); **pitchy** root note; ffmpeg `ebur128` and `silencedetect`. All MIT/BSD, so there is no AGPL exposure.
- Previews: MP3 128k (+ Opus optional), loudness-normalised previews only, JSON peaks computed in Node; **wavesurfer.js 8** in the UI.
- Licences: SPDX + `LicenseRef-*`, a computed `verdict.commercialRelease`, a default commercial-safe filter, `ATTRIBUTION.md` + `credits.json` written on download.
- Agent-friendliness: every field carries a source and confidence; a `get_waveform_png` tool; a GM-drum-note kit export; Strudel sample map export.

**v1.5**
- CLAP zero-shot (`@huggingface/transformers` + `Xenova/larger_clap_music_and_speech`, q8) as a classifier fallback behind a flag, with lazy model download (~330 MB). Set `ONNXRUNTIME_NODE_INSTALL_CUDA=skip`.
- Nearest-centroid classifier from a labelled seed set.
- SFZ/Decent Sampler kit export.

**v2**
- CLAP audio embeddings for cached samples in **sqlite-vec** (or pgvector if the hosted variant uses Postgres).
- `find_similar`, text→audio re-ranking, cross-source dedup.
- UMAP "sound map" in the UI.
- Basic-pitch MIDI extraction for melodic loops.
- Optional essentia (only if the project is AGPL or a commercial licence is obtained) for higher-accuracy key and BPM.

**Avoid:** fluent-ffmpeg (deprecated); essentia.js/aubio/pitchfinder/keyfinder in a closed hosted service (AGPL/GPL); web-audio-beat-detector server-side (needs Worker); Looperman scraping (ToS).

---

## Sources
- Freesound analysis descriptors: https://freesound.org/docs/api/analysis_docs.html ; API: https://freesound.org/docs/api
- Freesound Broad Sound Taxonomy: https://freesound.org/help/broad-sound-taxonomy/ ; https://blog.freesound.org/?p=2206 ; arXiv 2410.00980
- Freesound FAQ (licences, Sampling+, attribution): https://freesound.org/help/faq/
- CC Sampling+ retirement: https://creativecommons.org/2011/09/12/celebrating-freesound-2-0-retiring-sampling-licenses/ ; https://creativecommons.org/licenses/sampling+/1.0/
- Essentia licensing: https://essentia.upf.edu/licensing_information.html ; Essentia Freesound extractor: https://essentia.upf.edu/freesound_extractor.html
- essentia.js releases: https://github.com/MTG/essentia.js/releases
- fluent-ffmpeg deprecation: https://npmjs.com/package/fluent-ffmpeg
- music-metadata: https://github.com/Borewit/music-metadata (source inspected: lib/wav/WaveParser.js @12.2.3)
- BBC audiowaveform: https://github.com/bbc/audiowaveform
- wavesurfer.js 8.0.0 notes: https://newreleases.io/project/github/katspaugh/wavesurfer.js/release/8.0.0
- Xenova CLAP: https://huggingface.co/Xenova/clap-htsat-unfused ; https://huggingface.co/Xenova/larger_clap_music_and_speech ; LAION CLAP model cards (Apache-2.0)
- MS CLAP: https://pypi.org/project/msclap
- Splice: https://support.splice.com/en/articles/8652594-finding-sounds ; https://splice.com/blog/get-most-out-of-splice-sounds ; https://creators.splice.com/folder-organization
- Loopcloud: https://www.loopcloud.com/cloud/blog/5123-Your-Guide-to-Producing-with-Loopcloud
- Looperman terms: https://www.looperman.com/help/terms
- Audio Commons: https://github.com/AudioCommons/ac-mediator/wiki ; https://labs.freesound.org/tag/audiocommons/
- SampleMatch: https://arxiv.org/pdf/2208.01141 ; Drum transcription CLAP centroids: https://arxiv.org/pdf/2601.09520
- AudioStellar: https://gitlab.com/ayrsd/audiostellar/ ; https://flathub.org/apps/xyz.audiostellar.AudioStellar
- Freesound MCPs: glama.ai listings for johnkimdw/freesound-mcp-server, MuShan-bit/freesound-mcp, timjrobinson/FreesoundMCPServer
- Ableton MCP: https://mcpservers.org/servers/ahujasid/ableton-mcp ; Strudel MCP: https://glama.ai/mcp/servers/@williamzujkowski/strudel-mcp-server ; REAPER MCP: https://mcpservers.org/de/servers/xdarkzx/reaper-mcp
