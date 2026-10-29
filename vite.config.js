import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // transformers.js ships its own wasm loader; pre-bundling it breaks that.
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
})
