import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// One frontend, two TRAXELON sites. The Vite mode selects the site:
// `--mode built` for built.traxelon.com, `--mode data` for data.traxelon.com.
const sites = {
  built: {
    title: "TRAXELON Built — Website Technology",
    description: "TRAXELON Built detects website technologies, hosting, and infrastructure, and measures performance, SEO, and security.",
    devPort: 5173,
  },
  data: {
    title: "TRAXELON Data — Website Data Flows",
    description: "TRAXELON Data inspects website requests, third parties, cookies, storage, and the data fields sent to them.",
    devPort: 5174,
  },
};

export default defineConfig(({ mode }) => {
  const id = mode === "data" ? "data" : "built";
  const site = sites[id];
  return {
    root: "web",
    plugins: [
      react(),
      {
        name: "traxelon-site-meta",
        transformIndexHtml: (html) => html.replaceAll("%SITE_TITLE%", site.title).replaceAll("%SITE_DESCRIPTION%", site.description),
      },
    ],
    build: {
      outDir: `../web-dist/${id}`,
      emptyOutDir: true,
    },
    server: {
      port: site.devPort,
      proxy: {
        "/api": "http://127.0.0.1:4173",
      },
    },
  };
});
