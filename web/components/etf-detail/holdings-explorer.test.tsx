import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { HoldingsTable } from "@/components/etf-detail/holdings-table";
import { WeightHistoryChart } from "@/components/etf-detail/weight-history-chart";
import type { EtfHoldingRow } from "@/lib/etf-detail";

const rows: EtfHoldingRow[] = [
  {
    stockId: "2330",
    stockName: "台積電",
    industry: "半導體業",
    shares: 2_000,
    weightPct: 12,
    previousChange: "NEW",
    twentyDayChange: 8,
    entryDate: "2026-07-25",
    holdingDays: 4,
    isLongHeld: false,
  },
  {
    stockId: "2317",
    stockName: "鴻海",
    industry: "未分類",
    shares: 1_000,
    weightPct: 8,
    previousChange: 1,
    twentyDayChange: null,
    entryDate: "2026-07-01",
    holdingDays: 20,
    isLongHeld: true,
  },
  {
    stockId: "2454",
    stockName: "聯發科",
    industry: "半導體業",
    shares: 500,
    weightPct: 7,
    previousChange: -1,
    twentyDayChange: -2,
    entryDate: null,
    holdingDays: null,
    isLongHeld: false,
  },
];

beforeEach(() => pushMock.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("HoldingsTable", () => {
  it("defaults to weight descending and formats NEW, signed and missing changes", () => {
    render(
      <HoldingsTable
        etfId="00981A"
        rows={rows}
        selectedStockId="2330"
        previousDate="2026-07-30"
        twentyDayDate="2026-07-11"
      />,
    );

    const holdingRows = screen.getAllByTestId("holding-row");
    expect(within(holdingRows[0]).getByText("2330 台積電")).toBeInTheDocument();
    expect(within(holdingRows[0]).getByText("NEW")).toBeInTheDocument();
    expect(within(holdingRows[1]).getByText("+1.00%")).toBeInTheDocument();
    expect(within(holdingRows[1]).getByText("—")).toBeInTheDocument();
    expect(within(holdingRows[1]).getByText("長抱")).toBeInTheDocument();
    expect(within(holdingRows[0]).queryByText("長抱")).not.toBeInTheDocument();
    expect(holdingRows[0]).toHaveAttribute("aria-current", "true");
  });

  it("sorts numeric columns and keeps null values last", async () => {
    const user = userEvent.setup();
    render(
      <HoldingsTable
        etfId="00981A"
        rows={rows}
        selectedStockId="2330"
        previousDate="2026-07-30"
        twentyDayDate="2026-07-11"
      />,
    );

    await user.click(screen.getByRole("button", { name: "持有交易日排序" }));
    expect(screen.getAllByTestId("holding-row").map((row) => within(row).getAllByText(/\d{4}/)[0].textContent)).toEqual([
      "2317 鴻海",
      "2330 台積電",
      "2454 聯發科",
    ]);
    await user.click(screen.getByRole("button", { name: "持有交易日排序" }));
    expect(screen.getAllByTestId("holding-row").map((row) => within(row).getAllByText(/\d{4}/)[0].textContent)).toEqual([
      "2330 台積電",
      "2317 鴻海",
      "2454 聯發科",
    ]);
  });

  it("navigates on row click and keyboard activation", async () => {
    const user = userEvent.setup();
    render(
      <HoldingsTable
        etfId="00981A"
        rows={rows}
        selectedStockId="2330"
        previousDate="2026-07-30"
        twentyDayDate="2026-07-11"
      />,
    );

    const holdingRows = screen.getAllByTestId("holding-row");
    await user.click(holdingRows[1]);
    expect(pushMock).toHaveBeenCalledWith("/etf/00981A?stock=2317#weight-history");

    fireEvent.keyDown(holdingRows[2], { key: "Enter" });
    expect(pushMock).toHaveBeenCalledWith("/etf/00981A?stock=2454#weight-history");
    fireEvent.keyDown(holdingRows[0], { key: " " });
    expect(pushMock).toHaveBeenCalledWith("/etf/00981A?stock=2330#weight-history");
  });
});

describe("WeightHistoryChart", () => {
  it("renders a visible non-connected line and selected stock title", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 640,
      height: 320,
      top: 0,
      right: 640,
      bottom: 320,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    render(
      <WeightHistoryChart
        stockId="2330"
        stockName="台積電"
        points={[
          { tradeDate: "2026-07-01", weightPct: 2 },
          { tradeDate: "2026-07-05", weightPct: null },
          { tradeDate: "2026-07-10", weightPct: 3 },
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: "2330 台積電權重歷史" })).toBeInTheDocument();
    await waitFor(() =>
      expect(document.querySelectorAll(".recharts-line-curve").length).toBeGreaterThan(0),
    );
  });

  it("shows an empty state without a selected history", () => {
    render(<WeightHistoryChart stockId={null} stockName={null} points={[]} />);
    expect(screen.getByText("尚無持股權重歷史")).toBeInTheDocument();
  });
});
