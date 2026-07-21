import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchStockMock, notFoundMock } = vi.hoisted(() => ({
  fetchStockMock: vi.fn(),
  notFoundMock: vi.fn(),
}));

vi.mock("@/lib/stock-lookup-data", () => ({ fetchStockLookup: fetchStockMock }));
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return { ...actual, notFound: notFoundMock };
});

import StockLookupPage from "@/app/stock/[stockId]/page";

const detail = {
  stockId: "2330",
  stockName: "台積電",
  industry: "半導體業",
  latestDate: "2026-07-21",
  latestEtfCount: 2,
  holders: [],
  trend: [],
  events: [],
  warnings: [{ title: "近期爬蟲失敗", description: "00987A 讀取失敗" }],
  error: "部分欄位讀取失敗",
};

describe("StockLookupPage", () => {
  beforeEach(() => {
    fetchStockMock.mockReset();
    notFoundMock.mockReset();
  });

  it("calls notFound for a stock that never appeared", async () => {
    fetchStockMock.mockResolvedValue({ found: false, error: null });
    notFoundMock.mockImplementation(() => { throw new Error("NEXT_NOT_FOUND"); });

    await expect(StockLookupPage({
      params: Promise.resolve({ stockId: "UNKNOWN" }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(fetchStockMock).toHaveBeenCalledWith("UNKNOWN");
  });

  it("keeps a Supabase read failure visible instead of returning 404", async () => {
    fetchStockMock.mockResolvedValue({ found: false, error: "database unavailable" });

    render(await StockLookupPage({
      params: Promise.resolve({ stockId: "2330" }),
      searchParams: Promise.resolve({}),
    }));

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("database unavailable");
  });

  it("renders identity, current count, data alerts, all sections and the range", async () => {
    fetchStockMock.mockResolvedValue({ found: true, detail });

    render(await StockLookupPage({
      params: Promise.resolve({ stockId: "2330" }),
      searchParams: Promise.resolve({ range: "6M" }),
    }));

    expect(screen.getByRole("heading", { name: "2330 台積電" })).toBeInTheDocument();
    expect(screen.getByText("半導體業")).toBeInTheDocument();
    expect(screen.getByText("2 檔")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "6M" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "誰持有" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "全體合計權重走勢" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "事件歷史" })).toBeInTheDocument();
    expect(screen.getByText("近期爬蟲失敗")).toBeInTheDocument();
    expect(screen.getAllByRole("alert").some((alert) =>
      alert.textContent?.includes("部分欄位讀取失敗"),
    )).toBe(true);
    expect(screen.getByRole("note")).toHaveTextContent("不同代號視為不同股票");
  });
});
