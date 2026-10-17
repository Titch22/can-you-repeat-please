import { RECORDING_UPLOAD_GRACE_MS } from '@cyrp/shared';

/** Fixed phase durations (ms). Sound-dependent ones (reference, recording) derive from these. */
export interface Timing {
  /** "Round 2/5" card. */
  introMs: number;
  /** Delay before a scheduled sound starts, so every client has time to preload it. */
  referenceLeadMs: number;
  /** Silence after the reference before recording starts. */
  referenceTailMs: number;
  /** 3-2-1 before the recording window opens. */
  countdownMs: number;
  /** Uploads still accepted after the recording window closes. */
  uploadGraceMs: number;
  /** Delay before each playback item, for the "now playing" switch to reach clients. */
  playbackLeadMs: number;
  /** Silence after each playback item. */
  playbackGapMs: number;
  resultsMs: number;
}

export const DEFAULT_TIMING: Timing = {
  introMs: 3000,
  referenceLeadMs: 1500,
  referenceTailMs: 1000,
  countdownMs: 3000,
  uploadGraceMs: RECORDING_UPLOAD_GRACE_MS,
  playbackLeadMs: 400,
  playbackGapMs: 900,
  resultsMs: 6000,
};

/** For end-to-end tests (GAME_FAST=1): same flow, shorter waits. */
export const FAST_TIMING: Timing = {
  introMs: 500,
  referenceLeadMs: 800,
  referenceTailMs: 300,
  countdownMs: 1000,
  uploadGraceMs: RECORDING_UPLOAD_GRACE_MS,
  playbackLeadMs: 300,
  playbackGapMs: 300,
  resultsMs: 1500,
};
