import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChangeTimeline } from "@/components/etf-detail/change-timeline";
import { IndustryPieChart } from "@/components/etf-detail/industry-pie-chart";
import { PerformanceSummary } from "@/components/etf-detail/performance-summary";
import type { RankingRow } from "@/lib/rankings";

const metric: RankingRow = {
  etfId: "00981A",
  name: "主動統一台股增長",
  issuer: "統一",
  tradeDate: "2026-07-31",
  ret1m: 0.1,
  ret3m: null,
  ret6m: null,
  ret1y: null,
  retInception: 0.12,
  bench00501m: 0.08,
  bench00503m: null,
  bench00506m: null,
  bench00501y: null,
  bench0050Inception: 0.09,
  timingWins: 1,
  timingMonths: 2,
  pickingRealizedWins: 1,
  pickingRealizedTotal: 2,
  pickingOpenWins: 2,
  pickingOpenTotal: 3,
  medianHoldingDays: 8,
  weeklyTurnoverPct: 6.5,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PerformanceSummary", () => {
  it("shows returns with 0050 benchmarks, win-rate samples and style metrics", () => {
    render(<PerformanceSummary metric={metric} />);

    const oneMonth = screen.getByTestId("performance-ret1m");
    expect(within(oneMonth).getByText("+10.00%")).toBeInTheDocument();
    expect(within(oneMonth).getByText("0050 +8.00%")).toBeInTheDocument();
    const inception = screen.getByTestId("performance-retInception");
    expect(within(inception).getByText("0050 +9.00%")).toBeInTheDocument();
    expect(screen.queryByText("無同期基準")).not.toBeInTheDocument();
    expect(screen.getAllByText("50%（1/2）")).toHaveLength(2);
    expect(screen.getByText("67%（2/3）")).toBeInTheDocument();
    expect(screen.getAllByText("樣本不足")).toHaveLength(2);
    expect(screen.getByText("8 天")).toBeInTheDocument();
    expect(screen.getByText("6.5%")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(
      "此為訊號品質指標，未計部位大小，不等於績效貢獻",
    );
    expect(screen.getByRole("note")).toHaveTextContent(
      "日內沖銷不會出現在每日 PCF 快照中，無從計分",
    );
  });

  it("keeps missing metrics visible as an empty state", () => {
    render(<PerformanceSummary metric={null} />);
    expect(screen.getByText("尚無 ETF 指標快取")).toBeInTheDocument();
  });
});

describe("IndustryPieChart", () => {
  it("renders visible slices and an uncategorized legend entry", async () => {
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
      <IndustryPieChart
        industries={[
          { industry: "半導體業", weightPct: 19, stockCount: 2 },
          { industry: "未分類", weightPct: 3, stockCount: 1 },
        ]}
      />,
    );

    expect(screen.getByText("未分類")).toBeInTheDocument();
    expect(screen.getByText("3.00%")).toBeInTheDocument();
    await waitFor(() =>
      expect(document.querySelectorAll(".recharts-pie-sector path").length).toBeGreaterThan(0),
    );
  });
});

describe("ChangeTimeline", () => {
  it("groups dates and uses red-up green-down event badges", () => {
    render(
      <ChangeTimeline
        events={[
          {
            tradeDate: "2026-07-31",
            stockId: "2330",
            stockName: "台積電",
            changeType: "NEW",
            sharesDelta: 1_000,
            weightDeltaPct: 1.2,
          },
          {
            tradeDate: "2026-07-30",
            stockId: "2317",
            stockName: "鴻海",
            changeType: "EXIT",
            sharesDelta: -2_000,
            weightDeltaPct: -2.5,
          },
        ]}
      />,
    );

    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "2026-07-31",
      "2026-07-30",
    ]);
    expect(screen.getByText("NEW")).toHaveClass("text-red-700");
    expect(screen.getByText("EXIT")).toHaveClass("text-emerald-700");
    expect(screen.getByText("+1,000 股")).toBeInTheDocument();
    expect(screen.getByText("-2.50%")).toBeInTheDocument();
  });
});
