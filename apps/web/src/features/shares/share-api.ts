import {
  resolveSharePublicUrl,
  type PublicShareResponse,
  type Share,
  type ShareCreateRequest,
  type ShareDetail,
  type ShareOwnerItem,
  type ShareUpdateRequest,
} from "@keeppage/domain";
import {
  createShare as createShareLive,
  fetchPublicShare as fetchPublicShareLive,
  fetchShareDetail as fetchShareDetailLive,
  fetchShares as fetchSharesLive,
  revokeShare as revokeShareLive,
  updateShare as updateShareLive,
} from "../../api";
import {
  demoCreateShare,
  demoGetPublicShare,
  demoGetShareDetail,
  demoListShares,
  demoRevokeShare,
  demoUpdateShare,
  isDemoShareToken,
  type ShareDraftItem,
} from "./demo-store";

export type { ShareDraftItem };

export function withClientShareUrl(share: Share): Share {
  return {
    ...share,
    publicUrl: resolveSharePublicUrl({
      publicToken: share.publicToken,
      publicUrl: share.publicUrl,
      origin: typeof window !== "undefined" ? window.location.origin : "",
    }),
  };
}

export async function listShares(token: string): Promise<Share[]> {
  if (isDemoShareToken(token)) {
    return demoListShares();
  }
  const items = await fetchSharesLive(token);
  return items.map(withClientShareUrl);
}

export async function getShareDetail(shareId: string, token: string): Promise<ShareDetail> {
  if (isDemoShareToken(token)) {
    const detail = await demoGetShareDetail(shareId);
    return { ...withClientShareUrl(detail), items: detail.items };
  }
  const detail = await fetchShareDetailLive(shareId, token);
  return { ...withClientShareUrl(detail), items: detail.items };
}

export async function createShareFromDrafts(
  input: ShareCreateRequest,
  token: string,
  drafts: ShareDraftItem[],
): Promise<Share> {
  if (isDemoShareToken(token)) {
    return demoCreateShare(input, drafts);
  }
  const share = await createShareLive(input, token);
  return withClientShareUrl(share);
}

export async function updateShareItems(
  shareId: string,
  input: ShareUpdateRequest,
  token: string,
  knownItems?: ShareOwnerItem[],
): Promise<ShareDetail> {
  if (isDemoShareToken(token)) {
    const detail = await demoUpdateShare(shareId, input, knownItems);
    return { ...withClientShareUrl(detail), items: detail.items };
  }
  const detail = await updateShareLive(shareId, input, token);
  return { ...withClientShareUrl(detail), items: detail.items };
}

export async function revokeShareById(shareId: string, token: string): Promise<Share> {
  if (isDemoShareToken(token)) {
    return demoRevokeShare(shareId);
  }
  return withClientShareUrl(await revokeShareLive(shareId, token));
}

export async function getPublicShare(publicToken: string): Promise<PublicShareResponse> {
  // Demo shares live only in this browser's localStorage.
  try {
    return await demoGetPublicShare(publicToken);
  } catch {
    // fall through to live API
  }
  return fetchPublicShareLive(publicToken);
}
