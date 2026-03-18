declare module "single-file-core/single-file.js" {
  export function getPageData(
    options?: Record<string, unknown>,
    initOptions?: Record<string, unknown>,
    doc?: Document,
    win?: Window,
  ): Promise<{ content?: string | number[] }>;
}

declare module "single-file-core/single-file-bootstrap.js" {
  export const helper: Record<string, unknown>;
  export const processors: Record<string, unknown>;
}

declare module "single-file-core/single-file-frames.js";
declare module "single-file-core/single-file-hooks-frames.js";
