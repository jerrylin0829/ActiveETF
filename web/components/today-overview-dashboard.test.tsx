import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TodayOverviewDashboard } from "@/components/today-overview-dashboard";
import type { TodayOverviewViewModel } from "@/lib/today-overview";

const overview: TodayOverviewViewModel = {
  selectedDate: "2026-07-14",
  availableDates: ["2026-07-14", "2026-07-13"],
  range: "day",
  rangeOptions: [
    { value: "day", label: "當日", href: "/?date=2026-07-14&range=day", active: true },
    { value: "week", label: "本週", href: "/?date=2026-07-14&range=week", active: false },
    { value: "month", label: "本月", href: "/?date=2026-07-14&range=month", active: false },
  ],
  changeEvents: [
    {
      etfId: "00980A",
      etfName: "主動野村臺灣優選",
      issuer: "野村",
      tradeDate: "2026-07-14",
      stockId: "2330",
      stockName: "台積電",
      changeType: "NEW",
      sharesDelta: 12000,
      weightDeltaPct: 0.52,
    },
  ],
  collective: {
    increases: [
      {
        stockId: "2330",
        stockName: "台積電",
        etfCount: 2,
        totalWeightDeltaPct: 0.74,
      },
    ],
    decreases: [
      {
        stockId: "2303",
        stockName: "聯電",
        etfCount: 1,
        totalWeightDeltaPct: -0.31,
      },
    ],
  },
  radarPositions: [
    {
      etfId: "00980A",
      etfName: "主動野村臺灣優選",
      issuer: "野村",
      stockId: "2330",
      stockName: "台積電",
      entryDate: "2026-07-14",
      holdingTradingDays: 1,
      sharedEtfCount: 2,
      sharedSignal: "2 檔 ETF 近期同步建倉",
      excessReturnPct: 12.334,
      excessReturnNote: null,
    },
    {
      etfId: "00988A",
      etfName: "主動統一全球創新",
      issuer: "統一",
      stockId: "NVDA US",
      stockName: "NVDA US",
      entryDate: "2026-07-14",
      holdingTradingDays: 1,
      sharedEtfCount: 1,
      sharedSignal: null,
      excessReturnPct: null,
      excessReturnNote: "不適用",
    },
  ],
  warnings: [
    {
      title: "資料缺口",
      description: "2026-07-14 有 1 檔 ETF 爬蟲失敗：00987A 台新優勢成長（ValidationError: empty holdings）。",
    },
  ],
  error: null,
};

describe("TodayOverviewDashboard", () => {
  it("renders the overview sections, data gap warning, and radar placeholder", () => {
    const { container } = render(<TodayOverviewDashboard overview={overview} />);

    expect(screen.getByRole("heading", { name: "今日總覽" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ETF 排行榜" })).toHaveAttribute("href", "/rankings");
    expect(screen.getByRole("alert")).toHaveTextContent("00987A 台新優勢成長");

    expect(screen.getByRole("heading", { name: "異動牆" })).toBeInTheDocument();
    expect(screen.getByText("NEW")).toBeInTheDocument();
    expect(screen.getByText("+12,000")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /00980A 主動野村臺灣優選/ })).toHaveAttribute(
      "href",
      "/etf/00980A",
    );
    expect(screen.getAllByRole("link", { name: /2330.*台積電/ })[0]).toHaveAttribute(
      "href",
      "/stock/2330",
    );

    const collective = screen.getByRole("region", { name: "集體動向" });
    expect(within(collective).getByText("2330 台積電")).toBeInTheDocument();
    expect(within(collective).getByText("2 檔 ETF")).toBeInTheDocument();

    const radar = screen.getByRole("region", { name: "新倉追蹤雷達" });
    expect(within(radar).getByText("+12.33%")).toBeInTheDocument(); // |excess| >= 10 => colored
    expect(within(radar).getByText("不適用")).toBeInTheDocument(); // foreign holding
    expect(within(radar).getByText("2 檔 ETF 近期同步建倉")).toBeInTheDocument();
    expect(within(radar).getByRole("link", { name: /NVDA US/ })).toHaveAttribute(
      "href",
      "/stock/NVDA%20US",
    );
    expect(radar).toHaveClass("min-w-0");
    expect(container.querySelector("main > div")).toHaveClass("grid-cols-[minmax(0,1fr)]");
  });

  it("海外股票名稱 fallback 成代號時只顯示一次", () => {
    render(<TodayOverviewDashboard overview={overview} />);

    const radar = screen.getByRole("region", { name: "新倉追蹤雷達" });
    expect(within(radar).getByRole("link", { name: "NVDA US" })).toHaveTextContent(
      /^NVDA US$/,
    );
  });

  it("上方顯示最新資料更新日期", () => {
    render(<TodayOverviewDashboard overview={overview} />);

    expect(screen.getByText("資料更新至 2026-07-14")).toBeInTheDocument();
  });

  it("期間切換連結不重置頁面捲動位置", () => {
    render(<TodayOverviewDashboard overview={overview} />);

    expect(screen.getByTestId("range-link-week")).toHaveAttribute(
      "data-scroll",
      "false",
    );
  });
});
