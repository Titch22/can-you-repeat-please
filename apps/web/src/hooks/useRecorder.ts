import { useEffect, useState } from 'react';
import type { RoomState } from '@cyrp/shared';
import { audioContext } from '../lib/audio';
import { serverNow } from '../lib/clock';
import { loadSession } from '../lib/storage';

export type RecorderStatus =
  'idle' | 'preparing' | 'countdown' | 'recording' | 'uploading' | 'done' | 'no-mic' | 'error';

const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];

/**
 * Records the player during the round's recording window and uploads the result.
 * Uses its own mic stream (not the voice one) with noise suppression and auto gain off,
 * so weird noises survive.
 */
export function useRecorder(room: RoomState, canRecord: boolean) {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [level, setLevel] = useState(0);

  const slot = room.phase === 'RECORDING' && canRecord ? room.recording : null;
  const key = slot ? `${room.code}:${room.round}:${slot.startsAt}:${slot.endsAt}` : null;

  useEffect(() => {
    if (!key) return;
    const [code, round, startsAt, endsAt] = key.split(':') as [string, string, string, string];
    let stopped = false;
    let stream: MediaStream | null = null;
    let frame = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const upload = async (blob: Blob) => {
      setStatus('uploading');
      try {
        const res = await fetch(`/api/rooms/${code}/rounds/${round}/recording`, {
          method: 'POST',
          headers: { 'X-Session-Token': loadSession()?.sessionToken ?? '' },
          body: blob,
        });
        setStatus(res.ok ? 'done' : 'error');
      } catch {
        setStatus('error');
      }
    };

    void (async () => {
      setStatus('preparing');
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
        });
      } catch {
        setStatus('no-mic');
        return;
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop());

      // Level meter.
      const analyser = audioContext().createAnalyser();
      analyser.fftSize = 512;
      audioContext().createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const meter = () => {
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
        setLevel(Math.min(1, rms * 4));
        frame = requestAnimationFrame(meter);
      };
      meter();

      const mimeType = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      recorder.onstop = () => {
        cancelAnimationFrame(frame);
        stream?.getTracks().forEach((t) => t.stop());
        setLevel(0);
        // Upload even if the component unmounted meanwhile: the server still wants it.
        void upload(new Blob(chunks, { type: recorder.mimeType }));
      };

      setStatus('countdown');
      timers.push(
        setTimeout(
          () => {
            if (stopped) return;
            recorder.start();
            setStatus('recording');
            timers.push(
              setTimeout(
                () => recorder.state === 'recording' && recorder.stop(),
                Number(endsAt) - serverNow(),
              ),
            );
          },
          Number(startsAt) - serverNow(),
        ),
      );
    })();

    return () => {
      stopped = true;
      timers.forEach(clearTimeout);
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [key]);

  return { status, level };
}
