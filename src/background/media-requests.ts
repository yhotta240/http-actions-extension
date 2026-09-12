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

function getManifestKind(url: string): "manifest" | undefined {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (/\.(m3u8|mpd)$/.test(pathname)) return "manifest";
  } catch {
    return undefined;
  }
  return undefined;
}

function getMediaKind(
  url: string,
  responseHeaders: chrome.webRequest.HttpHeader[] | undefined,
): MediaCandidateKind | undefined {
  const manifestKind = getManifestKind(url);
  if (manifestKind) return manifestKind;

  const contentType = getContentType(responseHeaders);
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  return undefined;
}

function removeExpiredCandidates(candidates: MediaRequestCandidate[], now: number) {
  return candidates.filter((candidate) => now - candidate.lastSeenAt <= CANDIDATE_TTL_MS);
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
  const candidates = removeExpiredCandidates(candidatesByFrame.get(key) ?? [], now).filter(
    (candidate) => candidate.url !== details.url,
  );
  candidates.unshift({ url: details.url, kind, lastSeenAt: now });
  const storedCandidates = candidates.slice(0, MAX_CANDIDATES_PER_FRAME);
  candidatesByFrame.set(key, storedCandidates);
}

export function resolveDirectMediaUrl(
  tabId: number,
  frameId: number,
  context: MediaContext,
  currentUrl: string,
): string | undefined {
  if (HTTP_URL_PATTERN.test(currentUrl)) return currentUrl;
  if (!currentUrl.startsWith("blob:")) return undefined;

  const now = Date.now();
  const candidates = removeExpiredCandidates(
    candidatesByFrame.get(frameKey(tabId, frameId)) ?? [],
    now,
  );
  candidatesByFrame.set(frameKey(tabId, frameId), candidates);

  const manifests = candidates.filter((candidate) => candidate.kind === "manifest");
  if (manifests.length > 0) return manifests[0].url;

  const mediaCandidates = candidates.filter((candidate) => candidate.kind === context);
  if (mediaCandidates.length > 0) return mediaCandidates[0].url;
  return undefined;
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
