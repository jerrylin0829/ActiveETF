import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchDetailMock, notFoundMock } = vi.hoisted(() => ({
  fetchDetailMock: vi.fn(),
  notFoundMock: vi.fn(),
}));

vi.mock("@/lib/etf-detail-data", () => ({
  fetchEtfDetail: fetchDetailMock,
}));

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    notFound: notFoundMock,
    useRouter: () => ({ push: vi.fn() }),
  };
});

import EtfDetailPage from "@/app/etf/[etfId]/page";

const detail = {
  etfId: "00981A",
  name: "主動統一台股增長",
  issuer: "統一",
  latestDate: "2026-07-31",
  previousDate: "2026-07-30",
  twentyDayDate: null,
  metric: null,
  holdings: [],
  industries: [],
  changes: [],
  selectedStockId: null,
  selectedStockName: null,
  weightHistory: [],
  warnings: [{ title: "ETF 快照尚未更新", description: "最新快照落後。" }],
  error: "部分欄位讀取失敗",
};

describe("EtfDetailPage", () => {
  beforeEach(() => {
    fetchDetailMock.mockReset();
    notFoundMock.mockReset();
  });

  it("calls notFound for an unknown ETF id", async () => {
    fetchDetailMock.mockResolvedValue({ found: false, error: null });
    notFoundMock.mockImplementation(() => {
      throw new Error("NEXT_NOT_FOUND");
    });

    await expect(
      EtfDetailPage({
        params: Promise.resolve({ etfId: "UNKNOWN" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(fetchDetailMock).toHaveBeenCalledWith("UNKNOWN", undefined);
  });

  it("renders the ETF identity, sections, warnings and partial read errors", async () => {
    fetchDetailMock.mockResolvedValue({ found: true, detail });

    render(await EtfDetailPage({
      params: Promise.resolve({ etfId: "00981A" }),
      searchParams: Promise.resolve({ stock: "2330" }),
    }));

    expect(fetchDetailMock).toHaveBeenCalledWith("00981A", "2330");
    expect(screen.getByRole("heading", { name: "00981A 主動統一台股增長" })).toBeInTheDocument();
    expect(screen.getByText("統一")).toBeInTheDocument();
    expect(screen.getAllByRole("alert").some((alert) =>
      alert.textContent?.includes("部分欄位讀取失敗"),
    )).toBe(true);
    expect(screen.getByText("ETF 快照尚未更新")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "績效與操作風格" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "當前持股" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "產業配置" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "異動時間軸" })).toBeInTheDocument();
  });
});
