// Turns a raw transcript into notes, a todo list or a message. Uses Chrome's
// built-in on-device model (the Prompt API) when the browser has it, and a
// plain local cleanup otherwise. Either way nothing is sent to a server.

const PROMPTS = {
  notes:
    "Rewrite this voice note transcript as clean, well organised notes. Fix grammar, drop filler words and repetition, and keep the speaker's meaning and language. Use short paragraphs and '-' bullet points where they help. Output only the notes.",
  todos:
    "List every action item in this voice note transcript as a markdown checklist, one '- [ ] ' line each, short and starting with a verb. If there are none, output '- [ ] nothing to do found'. Output only the list.",
  message:
    "Turn this voice note transcript into a short, friendly message that is ready to send, two to four sentences. Output only the message.",
};

export async function onDeviceAvailability() {
  try {
    if (!("LanguageModel" in self)) return "unavailable";
    return await self.LanguageModel.availability({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    });
  } catch {
    return "unavailable";
  }
}

async function onDevice(mode, transcript, onDownload) {
  const session = await self.LanguageModel.create({
    initialPrompts: [{ role: "system", content: PROMPTS[mode] }],
    expectedInputs: [{ type: "text", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: ["en"] }],
    monitor(m) {
      m.addEventListener("downloadprogress", (e) => onDownload?.(e.loaded));
    },
  });
  try {
    const out = (await session.prompt(transcript)).trim();
    // Plain Chromium ships a stub that echoes the prompt back instead of a model.
    if (!out || out.startsWith("On-device model is not available") || out.includes(PROMPTS[mode])) {
      throw new Error("no on-device model");
    }
    return out;
  } finally {
    session.destroy();
  }
}

// --- local fallback -------------------------------------------------------

const FILLERS = /\b(um+|uh+|erm+|hmm+|you know|i mean|sort of|kind of|basically)\b,?\s*/gi;
const ACTION =
  /\b(need to|have to|has to|got to|gotta|should|must|remember to|don't forget to|do not forget to|make sure to|to-?do|i'll|i will|let's|call|email|text|message|buy|send|book|pay|finish|fix|follow up|schedule|check)\b/i;
const OPENERS = /^((okay|ok|so|also|and|then|right|well|anyway|alright|uh|um)[,]?\s+)+/i;
const LEAD_IN =
  /^(i think\s+)?(i|we)?\s*(really\s+)?(need to|have to|got to|gotta|should|must|will|'ll|am going to|are going to|want to)\s+/i;
const REMIND = /^(remember to|don't forget to|do not forget to|make sure to|to-?do:?)\s+/i;

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const dropOpeners = (s) => cap(s.replace(OPENERS, ""));

// "The screens look good, I think we should ship them" -> "Ship them"
function toTask(sentence) {
  const clause = sentence.split(/,\s+/).find((c) => ACTION.test(c)) ?? sentence;
  const task = clause.replace(OPENERS, "").replace(REMIND, "").replace(LEAD_IN, "").replace(/[.!?]+$/, "");
  return cap(task.trim());
}

export function clean(text) {
  return text
    .replace(FILLERS, "")
    .replace(/\b(\w+)(\s+\1\b)+/gi, "$1") // "the the" -> "the"
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map(cap)
    .join(" ");
}

function sentences(text) {
  return clean(text)
    .split(/(?<=[.!?])\s+|\s+(?:and then|and also|also)\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function localTidy(mode, transcript) {
  const parts = sentences(transcript).map(dropOpeners);
  if (mode === "todos") {
    const items = parts.filter((s) => ACTION.test(s)).map(toTask);
    return items.length ? items.map((i) => `- [ ] ${i}`).join("\n") : "- [ ] nothing to do found";
  }
  if (mode === "notes" && parts.length > 3) return parts.map((s) => `- ${s}`).join("\n");
  return parts.join(" ");
}

export async function tidy(mode, transcript, { useOnDevice, onDownload } = {}) {
  if (useOnDevice) {
    try {
      return { text: await onDevice(mode, transcript, onDownload), engine: "on-device ai" };
    } catch {
      return { text: localTidy(mode, transcript), engine: "basic cleanup", onDeviceFailed: true };
    }
  }
  return { text: localTidy(mode, transcript), engine: "basic cleanup" };
}
