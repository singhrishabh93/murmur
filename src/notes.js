// Saved notes live in localStorage (text only, audio is never kept).

const KEY = "murmur:notes:v1";

export function loadNotes() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list.filter((n) => n && typeof n.text === "string") : [];
  } catch {
    return [];
  }
}

export function saveNotes(notes) {
  try {
    localStorage.setItem(KEY, JSON.stringify(notes));
    return true;
  } catch {
    return false;
  }
}

export const noteTitle = (text) => {
  const first = text.replace(/^[-#*\s[\]x]+/i, "").split(/[.\n!?]/)[0].trim();
  return first.length > 60 ? `${first.slice(0, 57)}…` : first || "untitled note";
};

export function toMarkdown(notes) {
  return notes
    .map((n) => `## ${noteTitle(n.text)}\n_${new Date(n.createdAt).toLocaleString()}_\n\n${n.text}\n`)
    .join("\n");
}

export function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
