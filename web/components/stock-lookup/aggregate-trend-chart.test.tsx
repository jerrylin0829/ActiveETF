import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AggregateTrendChart } from "@/components/stock-lookup/aggregate-trend-chart";

afterEach(() => vi.restoreAllMocks());

describe("AggregateTrendChart", () => {
  it("renders range links and two visible series on separate axes", async () => {
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
      <AggregateTrendChart
        stockId="2330"
        range="1M"
        points={[
          { tradeDate: "2026-07-01", totalWeightPct: 18, etfCount: 3 },
          { tradeDate: "2026-07-21", totalWeightPct: 20, etfCount: 4 },
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: "1M" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "全部" })).toHaveAttribute(
      "href",
      "/stock/2330?range=all",
    );
    await waitFor(() => expect(document.querySelector(".recharts-surface")).toBeInTheDocument());
    expect(screen.getByText("合計權重")).toBeInTheDocument();
    expect(screen.getByText("持有 ETF 檔數")).toBeInTheDocument();
  });

  it("keeps both single-day values visible with reference dots", async () => {
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
      <AggregateTrendChart
        stockId="NVDA US"
        range="3M"
        points={[{ tradeDate: "2026-07-21", totalWeightPct: 6, etfCount: 2 }]}
      />,
    );

    await waitFor(() =>
      expect(document.querySelectorAll(".recharts-reference-dot-dot")).toHaveLength(2),
    );
  });

  it("renders an empty state", () => {
    render(<AggregateTrendChart stockId="2330" range="3M" points={[]} />);
    expect(screen.getByText("尚無合計權重走勢")).toBeInTheDocument();
  });
});
