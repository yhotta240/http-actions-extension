import type { MediaContext } from "../types/actions";

type MediaCandidateKind = "manifest" | MediaContext;

interface MediaRequestCandidate {
  url: string;
  kind: MediaCandidateKind;
  lastSeenAt: number;
}

const MAX_CANDIDATES_PER_FRAME = 16;
const CANDIDATE_TTL_MS = 5 * 60 * 1000;
const HTTP_URL_PATTERN = /^https?:\/\//i;
const candidatesByFrame = new Map<string, MediaRequestCandidate[]>();

function frameKey(tabId: number, frameId: number): string {
  return `${tabId}:${frameId}`;
}

function getContentType(responseHeaders: chrome.webRequest.HttpHeader[] | undefined): string {
  const contentType = responseHeaders?.find(
    (header) => header.name.toLowerCase() === "content-type",
  )?.value;
  return contentType?.split(";", 1)[0].trim().toLowerCase() ?? "";
}

function isManifestUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return /\.(m3u8|mpd)$/.test(pathname);
  } catch {
    return false;
  }
}

function getMediaKind(
  url: string,
  responseHeaders: chrome.webRequest.HttpHeader[] | undefined,
): MediaCandidateKind | undefined {
  if (isManifestUrl(url)) return "manifest";

  const contentType = getContentType(responseHeaders);
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  return undefined;
}

function removeExpiredCandidates(
  candidates: MediaRequestCandidate[],
  now: number,
): MediaRequestCandidate[] {
  return candidates.filter((candidate) => now - candidate.lastSeenAt <= CANDIDATE_TTL_MS);
}

function getActiveCandidates(tabId: number, frameId: number, now: number): MediaRequestCandidate[] {
  const key = frameKey(tabId, frameId);
  const candidates = removeExpiredCandidates(candidatesByFrame.get(key) ?? [], now);
  candidatesByFrame.set(key, candidates);
  return candidates;
}

function getLatestCandidateUrl(
  candidates: MediaRequestCandidate[],
  kind: MediaCandidateKind,
): string | undefined {
  return candidates.find((candidate) => candidate.kind === kind)?.url;
}

export function recordMediaRequest(
  details: Pick<
    chrome.webRequest.OnHeadersReceivedDetails,
    "tabId" | "frameId" | "url" | "responseHeaders" | "timeStamp"
  >,
): void {
  if (details.tabId < 0 || !HTTP_URL_PATTERN.test(details.url)) return;

  const kind = getMediaKind(details.url, details.responseHeaders);
  if (!kind) return;

  const now = details.timeStamp || Date.now();
  const key = frameKey(details.tabId, details.frameId);
  const candidates = getActiveCandidates(details.tabId, details.frameId, now).filter(
    (candidate) => candidate.url !== details.url,
  );
  candidates.unshift({ url: details.url, kind, lastSeenAt: now });
  candidatesByFrame.set(key, candidates.slice(0, MAX_CANDIDATES_PER_FRAME));
}

export function resolveDirectMediaUrl(
  tabId: number,
  frameId: number,
  context: MediaContext,
  currentUrl: string,
): string | undefined {
  if (HTTP_URL_PATTERN.test(currentUrl)) return currentUrl;
  if (!currentUrl.startsWith("blob:")) return undefined;

  const candidates = getActiveCandidates(tabId, frameId, Date.now());
  return (
    getLatestCandidateUrl(candidates, "manifest") ?? getLatestCandidateUrl(candidates, context)
  );
}

export function clearMediaRequestCandidates(tabId: number, frameId?: number): void {
  if (frameId === undefined) {
    for (const key of candidatesByFrame.keys()) {
      if (key.startsWith(`${tabId}:`)) candidatesByFrame.delete(key);
    }
    return;
  }
  candidatesByFrame.delete(frameKey(tabId, frameId));
}

export function registerMediaRequestTracking(): void {
  chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
      recordMediaRequest(details);
    },
    { urls: ["http://*/*", "https://*/*"] },
    ["responseHeaders"],
  );
}
