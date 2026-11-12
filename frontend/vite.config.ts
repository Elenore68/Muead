import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // amazon-cognito-identity-js (and its `buffer` dependency) read Node's `global`; browsers only have `globalThis`.
  define: { global: "globalThis" },
  server: { port: 8002, strictPort: true, host: "localhost" },
  preview: { port: 8002, strictPort: true },
});
