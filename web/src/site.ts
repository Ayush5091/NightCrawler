/**
 * Per-site branding. One codebase builds two TRAXELON tools:
 * `built` (built.traxelon.com) and `data` (data.traxelon.com).
 * The site is the Vite build mode: `vite build --mode built|data`.
 */
type SiteId = "built" | "data";
export type SectionId = "overview" | "audits" | "flows" | "browser-state" | "network" | "technologies" | "pages" | "findings";

interface SiteConfig {
  id: SiteId;
  name: string;
  tagline: string;
  heroEyebrow: string;
  heroTitle: [string, string];
  heroCopy: string;
  sections: SectionId[];
}

export const TOOLS_URL = "https://traxelon.com/tools";

const SITES: Record<SiteId, SiteConfig> = {
  built: {
    id: "built",
    name: "TRAXELON Built",
    tagline: "WEBSITE TECHNOLOGY",
    heroEyebrow: "Website technology",
    heroTitle: ["See how it's", "built."],
    heroCopy: "Detect frameworks, CMS, hosting, and infrastructure, then measure performance, SEO, and transport security from a real browser scan.",
    sections: ["overview", "audits", "network", "technologies", "pages"],
  },
  data: {
    id: "data",
    name: "TRAXELON Data",
    tagline: "WEBSITE DATA FLOWS",
    heroEyebrow: "Website observability",
    heroTitle: ["See beneath", "the surface."],
    heroCopy: "Scan pages, expose third-party paths, trace data fields, and turn a website’s hidden activity into evidence you can act on.",
    sections: ["overview", "flows", "browser-state", "network", "findings"],
  },
};

export const site: SiteConfig = SITES[import.meta.env.MODE === "data" ? "data" : "built"];

export const hasSection = (id: SectionId) => site.sections.includes(id);
export const sectionNumber = (id: SectionId) => String(site.sections.indexOf(id) + 1).padStart(2, "0");
