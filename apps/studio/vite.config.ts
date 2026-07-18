import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createLaunchBridgePlugin } from "./server/launchBridge";

const configuredPort = Number(process.env.SLIDES_STUDIO_STUDIO_PORT);
const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 4173;
const launched = Boolean(process.env.SLIDES_STUDIO_INITIAL_DECK && process.env.SLIDES_STUDIO_SESSION_TOKEN);

export default defineConfig({
  plugins: [createLaunchBridgePlugin(), react()],
  server: { host: "127.0.0.1", port, strictPort: launched },
  preview: { host: "127.0.0.1", port },
});
