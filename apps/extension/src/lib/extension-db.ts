import type {
  CaptureStatus,
  CaptureTask,
  PrivateAutoLock,
  PrivateCaptureTaskShell,
} from "@keeppage/domain";
import { openDB, type DBSchema } from "idb";

const DB_NAME = "keeppage-extension";
const DB_VERSION = 2;

export type EncryptedPayload = {
  algorithm: "AES-GCM";
  iv: string;
  ciphertext: string;
};

export type PrivateTaskPayload = {
  profile: CaptureTask["profile"];
  source: CaptureTask["source"];
  quality?: CaptureTask["quality"];
  artifacts?: CaptureTask["artifacts"];
  localArchiveSha256?: string;
  bookmarkId?: string;
  versionId?: string;
};

export type PrivateCaptureTaskRecord = {
  id: string;
  shell: PrivateCaptureTaskShell;
  encryptedPayload?: EncryptedPayload;
};

export type PrivateVaultRecord = {
  id: "primary";
  salt: string;
  verifier: string;
  autoLock: PrivateAutoLock;
  recoveryCodeDigest: string;
  createdAt: string;
  updatedAt: string;
};

interface KeepPageExtensionDB extends DBSchema {
  captureTasks: {
    key: string;
    value: CaptureTask;
    indexes: {
      "by-updated-at": string;
      "by-status": CaptureStatus;
    };
  };
  privateCaptureTasks: {
    key: string;
    value: PrivateCaptureTaskRecord;
    indexes: {
      "by-updated-at": string;
      "by-status": CaptureStatus;
    };
  };
  privateVault: {
    key: string;
    value: PrivateVaultRecord;
  };
}

export const dbPromise = openDB<KeepPageExtensionDB>(DB_NAME, DB_VERSION, {
  upgrade(database) {
    if (!database.objectStoreNames.contains("captureTasks")) {
      const taskStore = database.createObjectStore("captureTasks", {
        keyPath: "id",
      });
      taskStore.createIndex("by-updated-at", "updatedAt");
      taskStore.createIndex("by-status", "status");
    }

    if (!database.objectStoreNames.contains("privateCaptureTasks")) {
      const privateTaskStore = database.createObjectStore("privateCaptureTasks", {
        keyPath: "id",
      });
      privateTaskStore.createIndex("by-updated-at", "shell.updatedAt");
      privateTaskStore.createIndex("by-status", "shell.status");
    }

    if (!database.objectStoreNames.contains("privateVault")) {
      database.createObjectStore("privateVault", {
        keyPath: "id",
      });
    }
  },
});
