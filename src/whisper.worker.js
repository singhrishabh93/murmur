// Runs Whisper in the browser with transformers.js, off the main thread.
// The model downloads once from Hugging Face and is cached by the browser;
// audio never leaves this worker.
//
// It runs on the CPU (WASM) with 8-bit weights: ~77 MB for base. The WebGPU
// builds of Whisper need fp32/fp16 files that are 2-3x bigger, which is a
// worse trade for short voice notes.

import { pipeline } from "@huggingface/transformers";

const MODELS = {
  tiny: "onnx-community/whisper-tiny",
  base: "onnx-community/whisper-base",
};

let current = null; // { size, pipe }

async function load(size) {
  if (current?.size === size) return current.pipe;
  const pipe = await pipeline("automatic-speech-recognition", MODELS[size], {
    device: "wasm",
    dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
    progress_callback: (p) => {
      if (p.status === "progress_total") {
        postMessage({ type: "download", progress: p.progress, loaded: p.loaded, total: p.total });
      }
    },
  });
  current = { size, pipe };
  return pipe;
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "transcribe") {
      postMessage({ type: "status", status: "loading" });
      const pipe = await load(data.size);
      postMessage({ type: "status", status: "transcribing" });
      const out = await pipe(data.audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        language: data.language === "auto" ? null : data.language,
        task: "transcribe",
      });
      const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text).trim();
      postMessage({ type: "result", text });
    }
  } catch (err) {
    postMessage({ type: "error", message: String(err?.message ?? err) });
  }
};
