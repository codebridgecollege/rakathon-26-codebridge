// The browser-only parts of the AI recorder: the microphone at 16 kHz and the live socket to the speech service. The store decides
// which case takes the audio and when to reconnect; this module only talks to the browser. Nothing here logs audio or
// text.
import { REC_RATE } from "@codebridge/domain/recording";

export type Mic = { stop(): void };

// The microphone through a ScriptProcessor; onChunk gets each block of 4096 float samples.
export async function openMic(onChunk: (f32: Float32Array) => void): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  let ctx: AudioContext;
  try {
    // The browser resamples the microphone to 16 kHz, the format the speech service takes as raw PCM.
    ctx = new AudioContext({ sampleRate: REC_RATE });
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  // The processor only runs while connected to the output; a muted gain keeps the room from hearing itself.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  proc.onaudioprocess = (e) => onChunk(e.inputBuffer.getChannelData(0));
  src.connect(proc);
  proc.connect(mute);
  mute.connect(ctx.destination);
  return {
    stop() {
      proc.onaudioprocess = null;
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    },
  };
}

export type SttSocket = Pick<WebSocket, "readyState" | "send" | "close">;
export type SocketHandlers = { onOpen(): void; onMessage(m: Record<string, unknown>): void; onClose(): void };

export function openSocket(url: string, h: SocketHandlers): SttSocket {
  const ws = new WebSocket(url);
  ws.onopen = () => h.onOpen();
  ws.onmessage = (e) => {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(String(e.data)) as Record<string, unknown>;
    } catch {
      // Not a message of the service; nothing to show.
      return;
    }
    h.onMessage(m);
  };
  ws.onclose = () => h.onClose();
  return ws;
}

export const OPEN = 1;

function b64(bytes: Uint8Array): string {
  // In slices, because spreading a whole block into fromCharCode can exceed the argument limit.
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// One block of audio, exactly as the speech service's realtime API takes it.
export function sendChunk(ws: SttSocket, pcm: Int16Array): void {
  ws.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: b64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)), commit: false, sample_rate: REC_RATE }));
}

// Asks for the last sentence before closing (100 ms of silence with commit), so words spoken just before stopping are
// not lost.
export function sendCommit(ws: SttSocket): void {
  ws.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: b64(new Uint8Array(3200)), commit: true, sample_rate: REC_RATE }));
}
