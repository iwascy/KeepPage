import {
  createShareId,
  resolveSharePublicUrl,
  type PublicShareResponse,
  type Share,
  type ShareCreateRequest,
  type ShareDetail,
  type ShareOwnerItem,
  type ShareUpdateRequest,
} from "@keeppage/domain";

const DEMO_SHARES_STORAGE_KEY = "keeppage.demo-shares.v1";
export const DEMO_AUTH_TOKEN = "demo-token";

export type ShareDraftItem = {
  id: string;
  title: string;
  domain: string;
  sourceUrl?: string;
};

type DemoShareRecord = ShareDetail & {
  ownerDisplayName: string;
};

function nowIso() {
  return new Date().toISOString();
}

function readRecords(): DemoShareRecord[] {
  try {
    const raw = localStorage.getItem(DEMO_SHARES_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as DemoShareRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRecords(records: DemoShareRecord[]) {
  localStorage.setItem(DEMO_SHARES_STORAGE_KEY, JSON.stringify(records));
}

function toShareSummary(record: DemoShareRecord): Share {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    status: record.status,
    publicToken: record.publicToken,
    publicUrl: resolveSharePublicUrl({
      publicToken: record.publicToken,
      origin: typeof window !== "undefined" ? window.location.origin : "",
    }),
    itemCount: record.items.length,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revokedAt: record.revokedAt,
  };
}

function createPublicToken() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function isDemoShareToken(token: string) {
  return token === DEMO_AUTH_TOKEN;
}

export async function demoListShares(): Promise<Share[]> {
  return readRecords()
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(toShareSummary);
}

export async function demoGetShareDetail(shareId: string): Promise<ShareDetail> {
  const record = readRecords().find((item) => item.id === shareId);
  if (!record) {
    throw new Error("分享不存在。");
  }
  return {
    ...toShareSummary(record),
    items: record.items,
  };
}

export async function demoCreateShare(
  input: ShareCreateRequest,
  drafts: ShareDraftItem[],
): Promise<Share> {
  const records = readRecords();
  const activeCount = records.filter((item) => item.status === "active").length;
  if (activeCount >= 50) {
    throw new Error("每个账号最多保留 50 个活跃分享，请先撤销旧分享。");
  }

  const draftById = new Map(drafts.map((item) => [item.id, item]));
  const items: ShareOwnerItem[] = input.bookmarkIds.map((bookmarkId, position) => {
    const draft = draftById.get(bookmarkId);
    return {
      bookmarkId,
      position,
      title: draft?.title ?? "未命名书签",
      domain: draft?.domain ?? "unknown",
      sourceUrl: draft?.sourceUrl && /^https?:\/\//i.test(draft.sourceUrl)
        ? draft.sourceUrl
        : `https://example.com/${encodeURIComponent(bookmarkId)}`,
    };
  });

  const createdAt = nowIso();
  const record: DemoShareRecord = {
    id: createShareId(),
    title: input.title,
    description: input.description?.trim() ?? "",
    status: "active",
    publicToken: createPublicToken(),
    publicUrl: "",
    itemCount: items.length,
    createdAt,
    updatedAt: createdAt,
    items,
    ownerDisplayName: "Demo User",
  };
  record.publicUrl = resolveSharePublicUrl({
    publicToken: record.publicToken,
    origin: window.location.origin,
  });
  writeRecords([record, ...records]);
  return toShareSummary(record);
}

export async function demoUpdateShare(
  shareId: string,
  input: ShareUpdateRequest,
  knownItems?: ShareOwnerItem[],
): Promise<ShareDetail> {
  const records = readRecords();
  const index = records.findIndex((item) => item.id === shareId);
  if (index < 0) {
    throw new Error("分享不存在。");
  }
  const current = records[index]!;
  if (current.status !== "active") {
    throw new Error("已撤销的分享不可编辑。");
  }

  const knownById = new Map((knownItems ?? current.items).map((item) => [item.bookmarkId, item]));
  const nextItems = input.bookmarkIds
    ? input.bookmarkIds.map((bookmarkId, position) => {
      const known = knownById.get(bookmarkId);
      return {
        bookmarkId,
        position,
        title: known?.title ?? "未命名书签",
        domain: known?.domain ?? "unknown",
        sourceUrl: known?.sourceUrl ?? `https://example.com/${encodeURIComponent(bookmarkId)}`,
      };
    })
    : current.items;

  const updated: DemoShareRecord = {
    ...current,
    title: input.title ?? current.title,
    description: input.description ?? current.description,
    items: nextItems,
    itemCount: nextItems.length,
    updatedAt: nowIso(),
  };
  updated.publicUrl = resolveSharePublicUrl({
    publicToken: updated.publicToken,
    origin: window.location.origin,
  });
  records[index] = updated;
  writeRecords(records);
  return {
    ...toShareSummary(updated),
    items: updated.items,
  };
}

export async function demoRevokeShare(shareId: string): Promise<Share> {
  const records = readRecords();
  const index = records.findIndex((item) => item.id === shareId);
  if (index < 0) {
    throw new Error("分享不存在。");
  }
  const now = nowIso();
  const updated: DemoShareRecord = {
    ...records[index]!,
    status: "revoked",
    revokedAt: now,
    updatedAt: now,
  };
  records[index] = updated;
  writeRecords(records);
  return toShareSummary(updated);
}

export async function demoGetPublicShare(publicToken: string): Promise<PublicShareResponse> {
  const record = readRecords().find((item) => item.publicToken === publicToken && item.status === "active");
  if (!record) {
    throw new Error("链接无效或已取消分享");
  }
  return {
    title: record.title,
    description: record.description,
    ownerDisplayName: record.ownerDisplayName,
    itemCount: record.items.length,
    updatedAt: record.updatedAt,
    items: record.items.map((item) => ({
      title: item.title,
      sourceUrl: item.sourceUrl,
      domain: item.domain,
      note: "",
      tags: [],
      updatedAt: record.updatedAt,
      hasArchive: false,
    })),
  };
}
