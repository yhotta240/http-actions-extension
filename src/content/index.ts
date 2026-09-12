import type { MediaContext } from "../types/actions";

function getMediaUrl(media: HTMLMediaElement): string {
  return media.currentSrc || media.src;
}

function findMediaAtPoint(
  x: number,
  y: number,
): { context: MediaContext; url: string } | undefined {
  for (const element of document.elementsFromPoint(x, y)) {
    if (element instanceof HTMLVideoElement) {
      return { context: "video", url: getMediaUrl(element) };
    }
    if (element instanceof HTMLAudioElement) {
      return { context: "audio", url: getMediaUrl(element) };
    }
  }
  return undefined;
}

type DetectedMedia = ReturnType<typeof findMediaAtPoint>;

let lastMediaState = "";
let pointerPosition: { x: number; y: number } | undefined;
let pointerFrame: number | undefined;

function getMediaState(media: DetectedMedia): string {
  return media ? `${media.context}:${media.url}` : "none";
}

function notifyMediaContext(media: DetectedMedia, force = false): void {
  const state = getMediaState(media);
  if (!force && state === lastMediaState) return;
  lastMediaState = state;

  chrome.runtime.sendMessage(
    {
      type: "MEDIA_CONTEXT",
      mediaContext: media?.context,
      mediaUrl: media?.url,
      pageUrl: location.href,
    },
    () => {
      void chrome.runtime.lastError;
    },
  );
}

document.addEventListener(
  "pointermove",
  (event) => {
    pointerPosition = { x: event.clientX, y: event.clientY };
    if (pointerFrame !== undefined) return;

    pointerFrame = requestAnimationFrame(() => {
      pointerFrame = undefined;
      if (!pointerPosition) return;
      notifyMediaContext(findMediaAtPoint(pointerPosition.x, pointerPosition.y));
    });
  },
  true,
);

document.addEventListener(
  "contextmenu",
  (event) => {
    notifyMediaContext(findMediaAtPoint(event.clientX, event.clientY), true);
  },
  true,
);
