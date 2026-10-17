import { RECORDING_UPLOAD_GRACE_MS } from '@cyrp/shared';

/** Fixed phase durations (ms). Sound-dependent ones (reference, recording) derive from these. */
export interface Timing {
  /** "Round 2/5" card. */
  introMs: number;
  /** Delay before a scheduled sound starts, so every client has time to preload it. */
  referenceLeadMs: number;
  /** Pause after the reference ends ("Get ready to repeat it!"), before the 3-2-1. */
  referenceTailMs: number;
  /** 3-2-1 before the recording window opens. */
  countdownMs: number;
  /** Uploads still accepted after the recording window closes. */
  uploadGraceMs: number;
  /** Minimum pause after the recording window ("Time's up!"), even if every upload is in. */
  afterRecordingMs: number;
  /** Pause before the first playback item ("Here come the attempts!"). */
  playbackIntroMs: number;
  /** Delay before each later playback item, for the "now playing" switch to reach clients. */
  playbackLeadMs: number;
  /** Silence after each playback item. */
  playbackGapMs: number;
  resultsMs: number;
}

export const DEFAULT_TIMING: Timing = {
  introMs: 3000,
  referenceLeadMs: 1500,
  referenceTailMs: 3000,
  countdownMs: 3000,
  uploadGraceMs: RECORDING_UPLOAD_GRACE_MS,
  afterRecordingMs: 2500,
  playbackIntroMs: 3000,
  playbackLeadMs: 400,
  playbackGapMs: 1500,
  resultsMs: 6000,
};

/** For end-to-end tests (GAME_FAST=1): same flow, shorter waits. */
export const FAST_TIMING: Timing = {
  introMs: 500,
  referenceLeadMs: 800,
  referenceTailMs: 300,
  countdownMs: 1000,
  uploadGraceMs: RECORDING_UPLOAD_GRACE_MS,
  afterRecordingMs: 300,
  playbackIntroMs: 500,
  playbackLeadMs: 300,
  playbackGapMs: 300,
  resultsMs: 1500,
};
