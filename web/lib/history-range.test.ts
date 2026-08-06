import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  createReadOnlySupabaseClient: createClientMock,
}));

import {
  fetchHistoryRanges,
  formatHistoryFrom,
  type HistoryRange,
} from "@/lib/history-range";

describe("formatHistoryFrom", () => {
  const ranges: HistoryRange[] = [
    {
      etfId: "00981A",
      historyFrom: "2025-05-16",
      historyTo: "2026-07-24",
    },
  ];

  it("有資料時回傳起始日說明", () => {
    expect(formatHistoryFrom(ranges, "00981A")).toBe(
      "可用歷史資料自 2025-05-16 起",
    );
  });

  it("查無該 ETF 時回傳 null", () => {
    expect(formatHistoryFrom(ranges, "00404A")).toBeNull();
  });
});

describe("fetchHistoryRanges", () => {
  beforeEach(() => createClientMock.mockReset());

  it("將 view 欄位映射為前端型別", async () => {
    const select = vi.fn().mockResolvedValue({
      data: [
        {
          etf_id: "00981A",
          history_from: "2025-05-16",
          history_to: "2026-07-24",
        },
      ],
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn().mockReturnValue({ select }),
    });

    await expect(fetchHistoryRanges()).resolves.toEqual({
      ranges: [
        {
          etfId: "00981A",
          historyFrom: "2025-05-16",
          historyTo: "2026-07-24",
        },
      ],
      error: null,
    });
    expect(select).toHaveBeenCalledWith(
      "etf_id, history_from, history_to",
    );
  });

  it("Supabase 失敗時回傳可見錯誤", async () => {
    createClientMock.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "view missing" },
        }),
      }),
    });

    await expect(fetchHistoryRanges()).resolves.toEqual({
      ranges: [],
      error: "view missing",
    });
  });
});
