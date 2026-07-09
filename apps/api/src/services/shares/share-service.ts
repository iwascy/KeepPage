import { randomBytes } from "node:crypto";
import {
  buildSharePublicUrl,
  createShareId,
  SHARE_MAX_ITEMS,
  sanitizePublicShareResponse,
  type PublicShareResponse,
  type Share,
  type ShareCreateRequest,
  type ShareDetail,
  type ShareUpdateRequest,
} from "@keeppage/domain";
import { HttpError } from "../../lib/http-error";
import type { ShareRepository } from "../../repositories";

type ShareServiceOptions = {
  repository: ShareRepository;
  webPublicBaseUrl: string;
};

export class ShareService {
  private readonly repository: ShareRepository;
  private readonly webPublicBaseUrl: string;

  constructor(options: ShareServiceOptions) {
    this.repository = options.repository;
    this.webPublicBaseUrl = options.webPublicBaseUrl.replace(/\/$/, "");
  }

  async createShare(userId: string, input: ShareCreateRequest): Promise<Share> {
    const bookmarkIds = dedupePreserveOrder(input.bookmarkIds);
    await this.assertBookmarkIds(userId, bookmarkIds);

    // Active-share capacity is enforced atomically inside repository.createShare.
    const share = await this.repository.createShare(userId, {
      id: createShareId(),
      publicToken: createPublicToken(),
      title: input.title,
      description: input.description?.trim() ?? "",
      bookmarkIds,
    });
    return this.withPublicUrl(share);
  }

  async listShares(userId: string): Promise<Share[]> {
    const items = await this.repository.listShares(userId);
    return items.map((item) => this.withPublicUrl(item));
  }

  async getShareDetail(userId: string, shareId: string): Promise<ShareDetail> {
    const share = await this.repository.getShareDetail(userId, shareId);
    if (!share) {
      throw new HttpError(404, "ShareNotFound", "分享不存在。");
    }
    return this.withPublicUrlDetail(share);
  }

  async updateShare(userId: string, shareId: string, input: ShareUpdateRequest): Promise<ShareDetail> {
    if (input.bookmarkIds) {
      await this.assertBookmarkIds(userId, dedupePreserveOrder(input.bookmarkIds));
    }

    const share = await this.repository.updateShare(userId, shareId, {
      title: input.title,
      description: input.description,
      bookmarkIds: input.bookmarkIds ? dedupePreserveOrder(input.bookmarkIds) : undefined,
    });
    if (!share) {
      throw new HttpError(404, "ShareNotFound", "分享不存在。");
    }
    return this.withPublicUrlDetail(share);
  }

  async revokeShare(userId: string, shareId: string): Promise<Share> {
    const share = await this.repository.revokeShare(userId, shareId);
    if (!share) {
      throw new HttpError(404, "ShareNotFound", "分享不存在。");
    }
    return this.withPublicUrl(share);
  }

  async getPublicShare(token: string): Promise<PublicShareResponse> {
    const payload = await this.repository.getPublicShareByToken(token);
    if (!payload) {
      throw new HttpError(404, "ShareNotFound", "链接无效或已取消分享");
    }
    return sanitizePublicShareResponse(payload);
  }

  private async assertBookmarkIds(userId: string, bookmarkIds: string[]) {
    if (bookmarkIds.length === 0) {
      throw new HttpError(400, "ShareEmpty", "至少选择 1 条书签。");
    }
    if (bookmarkIds.length > SHARE_MAX_ITEMS) {
      throw new HttpError(
        400,
        "ShareItemLimitExceeded",
        `单个分享最多 ${SHARE_MAX_ITEMS} 条书签。`,
      );
    }
    const missing = await this.repository.findMissingOwnedBookmarkIds(userId, bookmarkIds);
    if (missing.length > 0) {
      throw new HttpError(
        400,
        "ShareBookmarkInvalid",
        "部分书签不存在、不属于当前账号，或无法分享（例如私密书签）。",
        { missingIds: missing },
      );
    }
  }

  private withPublicUrl(share: Share): Share {
    return {
      ...share,
      publicUrl: buildSharePublicUrl(this.webPublicBaseUrl, share.publicToken),
    };
  }

  private withPublicUrlDetail(share: ShareDetail): ShareDetail {
    return {
      ...share,
      publicUrl: buildSharePublicUrl(this.webPublicBaseUrl, share.publicToken),
    };
  }
}

function createPublicToken() {
  return randomBytes(18).toString("base64url");
}

function dedupePreserveOrder(ids: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
}
