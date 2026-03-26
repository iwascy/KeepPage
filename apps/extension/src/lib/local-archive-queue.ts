import { captureProfileSchema } from "./domain-runtime";
import { createLogger } from "./logger";
import { captureSourceUrl } from "./capture-pipeline";

type LocalArchiveQueueItem = {
  id: string;
  url: string;
  title?: string;
  bookmarkId?: string;
  createdAt: string;
};

type EnqueueLocalArchiveInput = {
  url: string;
  title?: string;
  bookmarkId?: string;
};

type EnqueueLocalArchiveResult = {
  acceptedCount: number;
  skippedCount: number;
  queueSize: number;
};

const LOCAL_ARCHIVE_QUEUE_KEY = "localArchiveQueue";
const LOCAL_ARCHIVE_PROCESSING_KEY = "localArchiveProcessing";
const logger = createLogger("local-archive-queue");
let drainingPromise: Promise<void> | null = null;

export async function enqueueLocalArchiveQueue(
  items: EnqueueLocalArchiveInput[],
): Promise<EnqueueLocalArchiveResult> {
  const normalizedItems = items
    .map(normalizeEnqueueItem)
    .filter((item): item is EnqueueLocalArchiveInput => item !== null);

  if (normalizedItems.length === 0) {
    const queue = await getQueueItems();
    return {
      acceptedCount: 0,
      skippedCount: items.length,
      queueSize: queue.length,
    };
  }

  const queue = await getQueueItems();
  const processingItem = await getProcessingItem();
  const existingUrls = new Set<string>();

  for (const item of queue) {
    existingUrls.add(item.url);
  }
  if (processingItem) {
    existingUrls.add(processingItem.url);
  }

  const queuedAt = new Date().toISOString();
  const nextQueue = [...queue];
  let acceptedCount = 0;
  let skippedCount = 0;

  for (const item of normalizedItems) {
    if (existingUrls.has(item.url)) {
      skippedCount += 1;
      continue;
    }
    acceptedCount += 1;
    existingUrls.add(item.url);
    nextQueue.push({
      id: `laq_${crypto.randomUUID()}`,
      url: item.url,
      title: item.title,
      bookmarkId: item.bookmarkId,
      createdAt: queuedAt,
    });
  }

  await setQueueItems(nextQueue);
  void drainLocalArchiveQueue();

  logger.info("Local archive queue updated.", {
    acceptedCount,
    skippedCount,
    queueSize: nextQueue.length,
    hasProcessingItem: Boolean(processingItem),
  });

  return {
    acceptedCount,
    skippedCount,
    queueSize: nextQueue.length,
  };
}

export async function drainLocalArchiveQueue() {
  if (drainingPromise) {
    return drainingPromise;
  }

  drainingPromise = (async () => {
    await recoverInterruptedProcessing();

    while (true) {
      const queue = await getQueueItems();
      if (queue.length === 0) {
        logger.debug("Local archive queue is empty, stopping drain.");
        return;
      }

      const [nextItem, ...rest] = queue;
      await setQueueItems(rest);
      await setProcessingItem(nextItem);

      logger.info("Processing local archive queue item.", {
        queueItemId: nextItem.id,
        url: nextItem.url,
        remainingQueueSize: rest.length,
      });

      try {
        await captureSourceUrl(
          nextItem.url,
          captureProfileSchema.parse("complete"),
          "standard",
        );
        logger.info("Local archive queue item completed.", {
          queueItemId: nextItem.id,
          url: nextItem.url,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("Local archive queue item failed.", {
          queueItemId: nextItem.id,
          url: nextItem.url,
          error: message,
        });

        if (isAuthBlockingError(message)) {
          await setQueueItems([nextItem, ...rest]);
          logger.warn("Stopping local archive drain because auth is required.", {
            queueItemId: nextItem.id,
            remainingQueueSize: rest.length + 1,
          });
          return;
        }
      } finally {
        await clearProcessingItem();
      }
    }
  })().finally(() => {
    drainingPromise = null;
  });

  return drainingPromise;
}

async function recoverInterruptedProcessing() {
  const processingItem = await getProcessingItem();
  if (!processingItem) {
    return;
  }

  const queue = await getQueueItems();
  const alreadyQueued = queue.some((item) => item.url === processingItem.url);
  if (!alreadyQueued) {
    await setQueueItems([processingItem, ...queue]);
  }
  await clearProcessingItem();

  logger.warn("Recovered interrupted local archive queue item.", {
    queueItemId: processingItem.id,
    url: processingItem.url,
    queueSize: alreadyQueued ? queue.length : queue.length + 1,
  });
}

async function getQueueItems() {
  const result = await chrome.storage.local.get(LOCAL_ARCHIVE_QUEUE_KEY);
  return parseQueueItems(result[LOCAL_ARCHIVE_QUEUE_KEY]);
}

async function setQueueItems(items: LocalArchiveQueueItem[]) {
  await chrome.storage.local.set({
    [LOCAL_ARCHIVE_QUEUE_KEY]: items,
  });
}

async function getProcessingItem() {
  const result = await chrome.storage.local.get(LOCAL_ARCHIVE_PROCESSING_KEY);
  return parseQueueItem(result[LOCAL_ARCHIVE_PROCESSING_KEY]);
}

async function setProcessingItem(item: LocalArchiveQueueItem) {
  await chrome.storage.local.set({
    [LOCAL_ARCHIVE_PROCESSING_KEY]: item,
  });
}

async function clearProcessingItem() {
  await chrome.storage.local.remove(LOCAL_ARCHIVE_PROCESSING_KEY);
}

function normalizeEnqueueItem(input: EnqueueLocalArchiveInput): EnqueueLocalArchiveInput | null {
  const url = input.url.trim();
  if (!url) {
    return null;
  }

  try {
    const normalizedUrl = new URL(url).toString();
    return {
      url: normalizedUrl,
      title: input.title?.trim() || undefined,
      bookmarkId: input.bookmarkId?.trim() || undefined,
    };
  } catch {
    return null;
  }
}

function parseQueueItems(input: unknown) {
  if (!Array.isArray(input)) {
    return [] as LocalArchiveQueueItem[];
  }
  return input
    .map(parseQueueItem)
    .filter((item): item is LocalArchiveQueueItem => item !== null);
}

function parseQueueItem(input: unknown): LocalArchiveQueueItem | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const maybe = input as Record<string, unknown>;
  const id = typeof maybe.id === "string" ? maybe.id.trim() : "";
  const url = typeof maybe.url === "string" ? maybe.url.trim() : "";
  const createdAt = typeof maybe.createdAt === "string" ? maybe.createdAt : "";
  if (!id || !url || !createdAt) {
    return null;
  }
  return {
    id,
    url,
    title: typeof maybe.title === "string" && maybe.title.trim() ? maybe.title.trim() : undefined,
    bookmarkId: typeof maybe.bookmarkId === "string" && maybe.bookmarkId.trim()
      ? maybe.bookmarkId.trim()
      : undefined,
    createdAt,
  };
}

function isAuthBlockingError(message: string) {
  return (
    message.includes("请先在扩展里登录账号")
    || message.includes("未登录账号")
    || message.includes("登录已失效")
  );
}
