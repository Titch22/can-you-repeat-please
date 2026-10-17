import { refreshDevices, saveInputId, savedInputId } from './devices';

/**
 * One microphone stream per room session, shared by voice chat and the recorder.
 *
 * Asking the browser for the mic again (getUserMedia) can show the permission prompt again:
 * Firefox does so whenever the tab isn't already capturing and the user didn't tick
 * "Remember this decision". Keeping a single stream open avoids a prompt every round.
 * Only picking another mic (setInputDevice) asks again.
 *
 * Settings suit recordings (no noise suppression or auto gain, so odd noises survive);
 * voice chat uses the same capture.
 */
const CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: false,
  autoGainControl: false,
};

const withDevice = (deviceId?: ConstrainDOMString): MediaTrackConstraints =>
  deviceId ? { ...CONSTRAINTS, deviceId } : CONSTRAINTS;

let stream: Promise<MediaStream> | null = null;
/** Whether a stream was already handed out: if a new one replaces it, listeners must follow. */
let acquired = false;
const listeners = new Set<(stream: MediaStream) => void>();

const isLive = (s: MediaStream) => s.getAudioTracks().some((t) => t.readyState === 'live');

/** Called with the new stream whenever the player switches mic. Returns an unsubscribe. */
export function onMicChange(listener: (stream: MediaStream) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export async function getMicStream(): Promise<MediaStream> {
  if (stream) {
    const current = await stream.catch(() => null);
    if (current && isLive(current)) return current;
    stream = null; // denied earlier, or the device went away: ask again
  }
  // `ideal`: if the saved mic is unplugged, the browser silently uses its default.
  const saved = savedInputId();
  const request = navigator.mediaDevices.getUserMedia({
    audio: withDevice(saved ? { ideal: saved } : undefined),
  });
  stream = request;
  request.then(
    (s) => {
      // Re-acquired (device unplugged, or a new room): meters and voice re-attach to it.
      if (acquired) listeners.forEach((listener) => listener(s));
      acquired = true;
      // Device labels only become readable once the mic is granted.
      void refreshDevices();
    },
    () => {},
  );
  return request;
}

/** Switches to another mic (null = browser default): voice and later recordings follow. */
export async function setInputDevice(id: string | null) {
  const next = await navigator.mediaDevices.getUserMedia({
    audio: withDevice(id ? { exact: id } : undefined),
  });
  const previous = stream;
  stream = Promise.resolve(next);
  saveInputId(id);
  listeners.forEach((listener) => listener(next));
  (await previous?.catch(() => null))?.getTracks().forEach((t) => t.stop());
  void refreshDevices();
}

/**
 * Stops the capture. Called when the player leaves the room (endSession), not on voice
 * reconnects: the next getMicStream() asks the browser again.
 */
export async function releaseMic() {
  const current = stream;
  stream = null;
  (await current?.catch(() => null))?.getTracks().forEach((t) => t.stop());
}
