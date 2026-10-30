import { useEffect, useState } from 'react';
import type { RoomState } from '@cyrp/shared';
import { audioContext } from '../lib/audio';
import { serverNow } from '../lib/clock';
import { getMicStream } from '../lib/mic';
import { loadSession } from '../lib/storage';
import { useDubScene } from '../lib/youtube';

export type RecorderStatus =
  'idle' | 'preparing' | 'countdown' | 'recording' | 'uploading' | 'done' | 'no-mic' | 'error';

const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];

/**
 * Records the player during the round's recording window and uploads the result.
 * Records from the shared mic stream (see lib/mic.ts), which is never stopped here: asking
 * for the mic again each round would show the browser's permission prompt again.
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
    let frame = 0;
    let recorder: MediaRecorder | null = null;
    let meterSource: MediaStreamAudioSourceNode | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let recordedFrom = 0;

    const upload = async (blob: Blob) => {
      setStatus('uploading');
      // Dub mode: the clip starts a moment after the recording, on each device its own moment.
      const scene = useDubScene.getState();
      const lead =
        scene.startsAt === Number(startsAt)
          ? `?leadMs=${Math.round(scene.sceneStartsAt - recordedFrom)}`
          : '';
      try {
        const res = await fetch(`/api/rooms/${code}/rounds/${round}/recording${lead}`, {
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
      let stream: MediaStream;
      try {
        stream = await getMicStream();
      } catch {
        setStatus('no-mic');
        return;
      }
      if (stopped) return;

      // Level meter.
      const analyser = audioContext().createAnalyser();
      analyser.fftSize = 512;
      meterSource = audioContext().createMediaStreamSource(stream);
      meterSource.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const meter = () => {
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
        setLevel(Math.min(1, rms * 4));
        frame = requestAnimationFrame(meter);
      };
      meter();

      const mimeType = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder = rec;
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      rec.onstop = () => {
        cancelAnimationFrame(frame);
        meterSource?.disconnect();
        setLevel(0);
        // Upload even if the component unmounted meanwhile: the server still wants it.
        void upload(new Blob(chunks, { type: rec.mimeType }));
      };

      setStatus('countdown');
      timers.push(
        setTimeout(
          () => {
            if (stopped) return;
            rec.start();
            recordedFrom = serverNow();
            setStatus('recording');
            timers.push(
              setTimeout(
                () => rec.state === 'recording' && rec.stop(),
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
      meterSource?.disconnect();
      // Phase ended mid-recording: stop (which uploads what we have). The mic itself stays open.
      if (recorder?.state === 'recording') recorder.stop();
    };
  }, [key]);

  return { status, level };
}
