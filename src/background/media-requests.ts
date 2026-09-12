import type { MediaContext } from "../types/actions";
import { getSessionStorage, setSessionStorage } from "../utils/storage";

type MediaCandidateKind = "manifest" | MediaContext;

interface MediaRequestCandidate {
  url: string;
  kind: MediaCandidateKind;
  lastSeenAt: number;
}

const MAX_CANDIDATES_PER_FRAME = 16;
const CANDIDATE_TTL_MS = 5 * 60 * 1000;
const HTTP_URL_PATTERN = /^https?:\/\//i;
const MEDIA_CANDIDATES_STORAGE_KEY = "media-request-candidates";
const candidatesByFrame = new Map<string, MediaRequestCandidate[]>();
let candidatesLoaded = false;
let candidatesLoadPromise: Promise<void> | undefined;
let persistenceQueue = Promise.resolve();

interface MediaCandidatesStorage {
  [key: string]: unknown;
  "media-request-candidates"?: Record<string, MediaRequestCandidate[]>;
}

function frameKey(tabId: number, frameId: number): string {
  return `${tabId}:${frameId}`;
}

function getContentType(responseHeaders: chrome.webRequest.HttpHeader[] | undefined): string {
  const contentType = responseHeaders?.find(
    (header) => header.name.toLowerCase() === "content-type",
  )?.value;
  return contentType?.split(";", 1)[0].trim().toLowerCase() ?? "";
}

async function ensureCandidatesLoaded(): Promise<void> {
  if (candidatesLoaded) return;

  candidatesLoadPromise ??= getSessionStorage<MediaCandidatesStorage>(MEDIA_CANDIDATES_STORAGE_KEY)
    .then((data) => {
      for (const [key, candidates] of Object.entries(data[MEDIA_CANDIDATES_STORAGE_KEY] ?? {})) {
        const currentCandidates = candidatesByFrame.get(key) ?? [];
        candidatesByFrame.set(key, limitCandidates([...candidates, ...currentCandidates]));
      }
      candidatesLoaded = true;
    })
    .finally(() => {
      candidatesLoadPromise = undefined;
    });

  await candidatesLoadPromise;
}

function persistCandidates(): Promise<void> {
  persistenceQueue = persistenceQueue
    .catch(() => undefined)
    .then(async () => {
      await ensureCandidatesLoaded();
      return setSessionStorage({
        [MEDIA_CANDIDATES_STORAGE_KEY]: Object.fromEntries(candidatesByFrame),
      });
    });
  return persistenceQueue;
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

function limitCandidatesByKind(
  candidates: MediaRequestCandidate[],
  kind: MediaCandidateKind,
): MediaRequestCandidate[] {
  return candidates
    .filter((candidate) => candidate.kind === kind)
    .slice(0, MAX_CANDIDATES_PER_FRAME);
}

function limitCandidates(candidates: MediaRequestCandidate[]): MediaRequestCandidate[] {
  return [
    limitCandidatesByKind(candidates, "manifest"),
    limitCandidatesByKind(candidates, "video"),
    limitCandidatesByKind(candidates, "audio"),
  ]
    .flat()
    .sort((left, right) => right.lastSeenAt - left.lastSeenAt);
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
  candidatesByFrame.set(key, limitCandidates(candidates));
  void persistCandidates().catch(() => undefined);
}

export async function resolveDirectMediaUrl(
  tabId: number,
  frameId: number,
  context: MediaContext,
  currentUrl: string,
): Promise<string | undefined> {
  if (HTTP_URL_PATTERN.test(currentUrl)) return currentUrl;
  if (!currentUrl.startsWith("blob:")) return undefined;

  await ensureCandidatesLoaded();
  const candidates = getActiveCandidates(tabId, frameId, Date.now());
  return (
    getLatestCandidateUrl(candidates, "manifest") ?? getLatestCandidateUrl(candidates, context)
  );
}

export async function clearMediaRequestCandidates(tabId: number, frameId?: number): Promise<void> {
  await ensureCandidatesLoaded();
  if (frameId === undefined) {
    for (const key of candidatesByFrame.keys()) {
      if (key.startsWith(`${tabId}:`)) candidatesByFrame.delete(key);
    }
    await persistCandidates();
    return;
  }
  candidatesByFrame.delete(frameKey(tabId, frameId));
  await persistCandidates();
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
