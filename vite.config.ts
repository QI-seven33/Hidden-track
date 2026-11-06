import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: process.env.BUILD_OUTPUT
      ? `${process.env.BUILD_OUTPUT}/client`
      : "dist/client",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5197,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:3197", ws: true } },
  },
});
