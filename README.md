# murmur

voice notes that never leave your laptop. https://murmur-local.vercel.app

- record in the browser, or drop in an audio file (phone voice memos work)
- whisper runs on your device through [transformers.js](https://github.com/huggingface/transformers.js); the model downloads once (77 MB, or 41 MB for the fast one) and is cached
- english, hindi and auto-detect
- turn the transcript into clean notes, a todo checklist or a short message. this uses chrome's built-in on-device ai when the browser has it, and a simple local cleanup otherwise
- saved notes stay in your browser (text only) and export as markdown for obsidian or notion

nothing is uploaded. there is no server.

```sh
npm install && npm run dev
```

built by Rishabh Singh — https://www.rishabhsingh.tech
