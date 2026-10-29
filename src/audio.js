// Microphone recording with a live level meter, and decoding any audio file
// into the 16 kHz mono samples Whisper expects.

export const SAMPLE_RATE = 16000;

export async function decodeAudio(blob) {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
    // Mix down to mono.
    const mono = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
    }
    return mono;
  } finally {
    ctx.close();
  }
}

export async function startRecording(onLevel) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  let frame;
  const tick = () => {
    analyser.getByteTimeDomainData(samples);
    let peak = 0;
    for (const s of samples) peak = Math.max(peak, Math.abs(s - 128));
    onLevel(Math.min(1, peak / 64));
    frame = requestAnimationFrame(tick);
  };
  tick();
  recorder.start(1000);

  return function stop() {
    return new Promise((resolve) => {
      recorder.onstop = () => {
        cancelAnimationFrame(frame);
        stream.getTracks().forEach((t) => t.stop());
        ctx.close();
        resolve(new Blob(chunks, { type: recorder.mimeType }));
      };
      recorder.stop();
    });
  };
}
