import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { think } from "@cloudflare/think/vite";

export default defineConfig(() => {
  return {
    server: {
      hmr: {
        overlay: false,
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      think(),
      cloudflare({
        configPath: "./wrangler.jsonc",
      }),
    ],
    resolve: {
    },
  };
});