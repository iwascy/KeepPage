import type {
  CaptureDownloadableMedia,
  CaptureProfile,
  SaveMode,
} from "@keeppage/domain";

export type SingleFilePageData = {
  content?: string | number[];
};

export type SingleFileGlobal = {
  singlefile?: {
    getPageData?: (
      options?: Record<string, unknown>,
      initOptions?: unknown,
      doc?: Document,
      win?: Window,
    ) => Promise<SingleFilePageData>;
  };
};

export type ArchiveCaptureResult =
  | {
      ok: true;
      archiveHtml: string;
      readerHtml?: string;
      downloadableMedia: CaptureDownloadableMedia[];
      usedSingleFile: boolean;
    }
  | {
      ok: false;
      error: string;
    };

export type ToastElements = {
  host: HTMLDivElement;
  toast: HTMLDivElement;
  title: HTMLParagraphElement;
  message: HTMLParagraphElement;
};

export type SelectionOverlayElements = {
  host: HTMLDivElement;
  frame: HTMLDivElement;
  label: HTMLDivElement;
  helper: HTMLDivElement;
};

export type ActiveSelection = {
  root: HTMLElement;
  descriptor: string;
  textPreview: string;
};

export type KeepPageBridgeRequest =
  | {
      source: "keeppage-web";
      target: "keeppage-extension";
      requestId: string;
      type: "enqueue-local-archive";
      payload: {
        items: Array<{
          url: string;
          title?: string;
          bookmarkId?: string;
        }>;
      };
    }
  | {
      source: "keeppage-web";
      target: "keeppage-extension";
      requestId: string;
      type: "extension-connect-code";
      payload: {
        code: string;
        apiBaseUrl: string;
        connectNonce: string;
        expiresAt?: string;
      };
    };

export type KeepPageBridgeResponse = {
  source: "keeppage-extension";
  target: "keeppage-web";
  requestId: string;
  ok: boolean;
  payload?: unknown;
  error?: string;
};

export type SelectionSession = {
  profile: CaptureProfile;
  saveMode: SaveMode;
  hoveredElement: HTMLElement | null;
  overlay: SelectionOverlayElements;
  detach: () => void;
};

export const TOAST_HOST_ID = "keeppage-in-page-toast";
export const SELECTION_OVERLAY_HOST_ID = "keeppage-selection-overlay";
export const SELECTION_MARKER_ATTR = "data-keeppage-selection-root";
export const MIN_COVER_IMAGE_WIDTH = 240;
export const MIN_COVER_IMAGE_HEIGHT = 135;
export const MIN_COVER_IMAGE_AREA = 48_000;
export const PREFERRED_SELECTION_TAGS = new Set([
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DIV",
  "FIGURE",
  "IMG",
  "LI",
  "MAIN",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "UL",
  "OL",
  "VIDEO",
]);
