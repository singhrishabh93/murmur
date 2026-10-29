import { useEffect, useEffectEvent, useRef, useState } from "react";
import Shell from "./Shell.jsx";
import { decodeAudio, startRecording } from "./audio.js";
import { download, loadNotes, noteTitle, saveNotes, toMarkdown } from "./notes.js";
import { onDeviceAvailability, tidy } from "./tidy.js";

const SAMPLE_URL = "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav";
const MAX_SECONDS = 15 * 60;
const MODES = [
  ["transcript", "transcript"],
  ["notes", "notes"],
  ["todos", "todos"],
  ["message", "message"],
];
const SIZES = [
  ["base", "accurate · 77 MB"],
  ["tiny", "fast · 40 MB"],
];
const LANGUAGES = [
  ["auto", "detect language"],
  ["english", "english"],
  ["hindi", "hindi"],
];

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const mb = (bytes) => `${Math.round(bytes / 1e6)} MB`;

function useWhisper() {
  const worker = useRef(null);
  const pending = useRef(null);
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    const w = new Worker(new URL("./whisper.worker.js", import.meta.url), { type: "module" });
    w.onmessage = ({ data }) => {
      if (data.type === "download") setProgress(data);
      else if (data.type === "status") pending.current?.onStatus(data);
      else if (data.type === "result") pending.current?.resolve(data);
      else if (data.type === "error") pending.current?.reject(new Error(data.message));
    };
    worker.current = w;
    return () => w.terminate();
  }, []);

  const transcribe = (audio, { size, language, onStatus }) =>
    new Promise((resolve, reject) => {
      pending.current = { resolve, reject, onStatus };
      worker.current.postMessage({ type: "transcribe", audio, size, language }, [audio.buffer]);
    }).finally(() => setProgress(null));

  return { transcribe, progress };
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef();
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button type="button" className="btn" onClick={copy} disabled={!text}>
      {copied ? "copied" : "copy"}
    </button>
  );
}

function Meter({ level, active }) {
  return (
    <div className={`meter ${active ? "is-active" : ""}`} aria-hidden="true">
      {Array.from({ length: 24 }, (_, i) => {
        const shape = 0.35 + 0.65 * Math.sin(((i + 1) / 25) * Math.PI);
        const h = active ? 6 + level * 46 * shape * (0.7 + 0.3 * Math.sin(i * 2.3 + level * 9)) : 6;
        return <span key={i} style={{ height: `${Math.max(4, h)}px` }} />;
      })}
    </div>
  );
}

export default function App() {
  const { transcribe, progress } = useWhisper();
  const [size, setSize] = useState("base");
  const [language, setLanguage] = useState("auto");
  const [phase, setPhase] = useState("idle"); // idle | recording | working | done
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [outputs, setOutputs] = useState({});
  const [mode, setMode] = useState("transcript");
  const [engine, setEngine] = useState("");
  const [tidying, setTidying] = useState(false);
  const [aiState, setAiState] = useState("checking");
  const [notes, setNotes] = useState(loadNotes);
  const [open, setOpen] = useState(null);
  const [dragging, setDragging] = useState(false);
  const stopRef = useRef(null);
  const fileRef = useRef(null);
  const onLimit = useEffectEvent(() => stop());

  useEffect(() => {
    onDeviceAvailability().then(setAiState);
  }, []);

  useEffect(() => {
    if (phase !== "recording") return undefined;
    const started = Date.now();
    const id = setInterval(() => {
      const s = (Date.now() - started) / 1000;
      setSeconds(s);
      if (s >= MAX_SECONDS) onLimit();
    }, 250);
    return () => clearInterval(id);
  }, [phase]);

  async function run(blob) {
    setPhase("working");
    setError("");
    setOutputs({});
    setMode("transcript");
    setEngine("");
    try {
      setStatus("reading audio…");
      const audio = await decodeAudio(blob);
      if (audio.length < 1600) throw new Error("that recording is too short");
      const { text } = await transcribe(audio, {
        size,
        language,
        onStatus: (s) =>
          setStatus(s.status === "loading" ? "loading whisper…" : "transcribing on your device…"),
      });
      setOutputs({ transcript: text || "(no speech found)" });
      setPhase("done");
    } catch (err) {
      setError(err.message || String(err));
      setPhase("idle");
    } finally {
      setStatus("");
    }
  }

  async function record() {
    setError("");
    try {
      stopRef.current = await startRecording(setLevel);
      setSeconds(0);
      setPhase("recording");
    } catch {
      setError("couldn't reach the microphone. allow mic access, or drop an audio file instead.");
    }
  }

  async function stop() {
    const stopFn = stopRef.current;
    stopRef.current = null;
    if (!stopFn) return;
    setLevel(0);
    run(await stopFn());
  }

  async function trySample() {
    setPhase("working");
    setStatus("fetching the sample…");
    try {
      run(await (await fetch(SAMPLE_URL)).blob());
    } catch {
      setError("couldn't fetch the sample clip");
      setPhase("idle");
    }
  }

  function onFile(file) {
    if (file && (file.type.startsWith("audio/") || file.type.startsWith("video/") || /\.(m4a|mp3|wav|ogg|webm|aac|opus)$/i.test(file.name))) {
      run(file);
    } else if (file) {
      setError("that doesn't look like an audio file");
    }
  }

  async function pick(next) {
    setMode(next);
    if (outputs[next] !== undefined || !outputs.transcript) return;
    setTidying(true);
    const useOnDevice = aiState === "available" || aiState === "downloadable" || aiState === "downloading";
    const result = await tidy(next, outputs.transcript, { useOnDevice });
    setOutputs((o) => ({ ...o, [next]: result.text }));
    setEngine(result.engine);
    if (result.onDeviceFailed) setAiState("unavailable");
    setTidying(false);
  }

  function save() {
    const text = outputs[mode];
    if (!text) return;
    const next = [{ id: Date.now().toString(36), createdAt: Date.now(), kind: mode, text }, ...notes];
    setNotes(next);
    saveNotes(next);
  }

  function remove(id) {
    const next = notes.filter((n) => n.id !== id);
    setNotes(next);
    saveNotes(next);
  }

  const busy = phase === "working";
  const current = outputs[mode] ?? "";
  const aiLabel =
    aiState === "available" || aiState === "downloadable" || aiState === "downloading"
      ? "tidy-up runs on Chrome's built-in on-device AI"
      : "tidy-up uses a simple local cleanup. open in a Chrome with built-in AI for smarter notes";

  return (
    <Shell repo="murmur">
      <header className="hero">
        <h1>murmur</h1>
        <p className="lede">
          talk, and get clean notes back. whisper runs right here in your browser, so your voice never leaves your laptop.
        </p>
      </header>

      <section
        className={`recorder ${dragging ? "is-dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy && phase !== "recording") onFile(e.dataTransfer.files?.[0]);
        }}
      >
        <button
          type="button"
          className={`rec ${phase === "recording" ? "is-recording" : ""}`}
          onClick={phase === "recording" ? stop : record}
          disabled={busy}
          aria-label={phase === "recording" ? "stop recording" : "start recording"}
        >
          <span className="rec-icon" />
        </button>
        <Meter level={level} active={phase === "recording"} />
        <p className="rec-time">
          {phase === "recording" ? clock(seconds) : busy ? status || "working…" : "tap to record"}
        </p>

        {busy && progress ? (
          <div className="bar" role="progressbar" aria-valuenow={Math.round(progress.progress)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${progress.progress}%` }} />
            <em>
              downloading whisper, once · {mb(progress.loaded)} of {mb(progress.total)}
            </em>
          </div>
        ) : null}

        <p className="rec-alt">
          or{" "}
          <button type="button" className="link" onClick={() => fileRef.current?.click()} disabled={busy || phase === "recording"}>
            pick an audio file
          </button>{" "}
          (drop one here too) ·{" "}
          <button type="button" className="link" onClick={trySample} disabled={busy || phase === "recording"}>
            try a sample
          </button>
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,video/*,.m4a"
          hidden
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        <div className="settings">
          <label>
            model
            <select value={size} onChange={(e) => setSize(e.target.value)} disabled={busy}>
              {SIZES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            language
            <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={busy}>
              {LANGUAGES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </section>

      {outputs.transcript !== undefined ? (
        <section className="result">
          <div className="tabs" role="tablist" aria-label="output">
            {MODES.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={mode === key}
                className={`tab ${mode === key ? "is-active" : ""}`}
                onClick={() => pick(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <textarea
            className="output"
            value={tidying ? "tidying up…" : current}
            readOnly={tidying}
            onChange={(e) => setOutputs((o) => ({ ...o, [mode]: e.target.value }))}
            aria-label={`${mode} text`}
            rows={8}
          />
          <div className="result-foot">
            <span className="hint">{mode === "transcript" ? "edit anything before saving" : engine}</span>
            <div className="row">
              <CopyButton text={tidying ? "" : current} />
              <button type="button" className="btn btn-dark" onClick={save} disabled={tidying || !current}>
                save note
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <p className="hint ai-note">{aiState === "checking" ? "" : aiLabel}</p>

      <section className="saved">
        <div className="saved-head">
          <h2>saved notes {notes.length ? <span className="count">{notes.length}</span> : null}</h2>
          {notes.length ? (
            <button type="button" className="link" onClick={() => download("murmur-notes.md", toMarkdown(notes))}>
              export as markdown
            </button>
          ) : null}
        </div>
        {notes.length ? (
          <ul className="notes">
            {notes.map((n) => (
              <li key={n.id} className="note">
                <button type="button" className="note-head" onClick={() => setOpen(open === n.id ? null : n.id)} aria-expanded={open === n.id}>
                  <span className="note-title">{noteTitle(n.text)}</span>
                  <span className="note-meta">
                    {n.kind} · {new Date(n.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  </span>
                </button>
                {open === n.id ? (
                  <div className="note-body">
                    <pre>{n.text}</pre>
                    <div className="row">
                      <CopyButton text={n.text} />
                      <button type="button" className="btn" onClick={() => download(`${noteTitle(n.text)}.md`, n.text)}>
                        .md
                      </button>
                      <button type="button" className="btn btn-danger" onClick={() => remove(n.id)}>
                        delete
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">nothing saved yet. notes stay in this browser only.</p>
        )}
      </section>

      <section className="privacy">
        <h2>where your voice goes</h2>
        <ul>
          <li>nowhere. recording, transcription and tidy-up all happen on your device.</li>
          <li>the whisper model downloads once from hugging face and stays cached in your browser.</li>
          <li>saved notes are text only, kept in this browser. audio is never stored.</li>
        </ul>
      </section>
    </Shell>
  );
}
