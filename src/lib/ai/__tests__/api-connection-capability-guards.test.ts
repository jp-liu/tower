import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    providerConnection: { findUnique: vi.fn(), delete: vi.fn() },
    apiConnectionModel: { findUnique: vi.fn(), delete: vi.fn() },
    aiCapabilityTarget: { findFirst: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import {
  deleteApiConnectionService,
  removeManualApiModelService,
} from "../api-connection-service";

const mockDb = db as unknown as {
  providerConnection: { findUnique: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  apiConnectionModel: { findUnique: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  aiCapabilityTarget: { findFirst: ReturnType<typeof vi.fn> };
};

describe("capability reference deletion guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.providerConnection.findUnique.mockResolvedValue({
      id: "api", kind: "api", apiKeys: [], models: [], headersJson: "[]", queryParamsJson: "[]",
    });
  });

  it("rejects deleting a referenced connection with a stable code", async () => {
    mockDb.aiCapabilityTarget.findFirst.mockResolvedValue({ id: "target" });
    await expect(deleteApiConnectionService("api")).rejects.toMatchObject({ code: "connection_in_use" });
    expect(mockDb.providerConnection.delete).not.toHaveBeenCalled();
  });

  it("rejects deleting a referenced manual model with a stable code", async () => {
    mockDb.apiConnectionModel.findUnique.mockResolvedValue({ id: "model-row", source: "manual" });
    mockDb.aiCapabilityTarget.findFirst.mockResolvedValue({ id: "target" });
    await expect(removeManualApiModelService("api", "model"))
      .rejects.toMatchObject({ code: "model_in_use" });
    expect(mockDb.apiConnectionModel.delete).not.toHaveBeenCalled();
  });
});
