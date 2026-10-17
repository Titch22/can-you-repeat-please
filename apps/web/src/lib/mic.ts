/**
 * One microphone stream per room session, shared by voice chat and the recorder.
 *
 * Asking the browser for the mic again (getUserMedia) can show the permission prompt again:
 * Firefox does so whenever the tab isn't already capturing and the user didn't tick
 * "Remember this decision". Keeping a single stream open avoids a prompt every round.
 *
 * Settings suit recordings (no noise suppression or auto gain, so odd noises survive);
 * voice chat uses the same capture.
 */
const CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: false,
  autoGainControl: false,
};

let stream: Promise<MediaStream> | null = null;

const isLive = (s: MediaStream) => s.getAudioTracks().some((t) => t.readyState === 'live');

export async function getMicStream(): Promise<MediaStream> {
  if (stream) {
    const current = await stream.catch(() => null);
    if (current && isLive(current)) return current;
    stream = null; // denied earlier, or the device went away: ask again
  }
  stream = navigator.mediaDevices.getUserMedia({ audio: CONSTRAINTS });
  return stream;
}

/** Stops the capture (leaving the room). The next getMicStream() asks the browser again. */
export async function releaseMic() {
  const current = stream;
  stream = null;
  (await current?.catch(() => null))?.getTracks().forEach((t) => t.stop());
}
