/**
 * The Rift-CMP website scanner.
 *
 * Discovery, not enforcement. Everything this package produces is an
 * observation: *this cookie was set*, *this host was contacted*, *this script
 * loaded*, under one stated scan configuration. None of it is a legal
 * determination, and nothing here decides what a site is permitted to do.
 *
 * That boundary is the reason the package exists separately from the consent
 * domain. See `docs/crawler.md`.
 */

export { crawl, CRAWLER_VERSION, USER_AGENT, ScanFatalError } from "./crawl";
export type { CrawlOptions, CrawlEvent } from "./crawl";

export {
  assertNavigable,
  checkUrlShape,
  isBlockedAddress,
  isBlockedHostname,
  MAX_URL_LENGTH,
} from "./ssrf";
export type { SsrfVerdict, SsrfRejection, Resolver } from "./ssrf";

export {
  normaliseUrl,
  acceptLink,
  isSameOrigin,
  isThirdParty,
  TRACKING_PARAMETERS,
  MAX_QUERY_PARAMETERS,
} from "./url";
export type { NormalisedUrl, UrlRejection } from "./url";

export { parseRobots, isAllowed, pathForRobots, permissivePolicy } from "./robots";
export type { RobotsPolicy, RobotsRule } from "./robots";

export { DETECTORS, detectTechnologies } from "./detectors";
export type { TrackerDetector, DetectionInput, DetectionResult } from "./detectors";

export { DEFAULT_LIMITS, SCAN_STATUSES, SCAN_MODES } from "./types";
export type {
  CrawlLimits,
  ScanStatus,
  ScanMode,
  ScanResult,
  ScanSummary,
  PageObservation,
  CookieObservation,
  ScriptObservation,
  RequestObservation,
  StorageObservation,
  ConsentUiObservation,
  TechnologyFinding,
  Evidence,
  Confidence,
} from "./types";
