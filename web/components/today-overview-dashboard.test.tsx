import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
        totalValueTwd: 2750000000,
      },
    ],
    decreases: [
      {
        stockId: "2303",
        stockName: "聯電",
        etfCount: 1,
        totalValueTwd: null,
      },
    ],
  },
  radarNarratives: [
    {
      stockId: "2330",
      stockName: "台積電",
      industry: "半導體業",
      etfCount: 2,
      issuerCount: 2,
      followUpCount: 1,
      entryValueTwd: 1000000,
      addValueTwd: 200000,
      segment: "multi_add",
      legs: [
        {
          etfId: "00980A",
          etfName: "主動野村臺灣優選",
          issuer: "野村",
          entryDate: "2026-07-14",
          holdingTradingDays: 1,
          excessReturnPct: 12.334,
          excessReturnNote: null,
          followUps: [
            { tradeDate: "2026-07-15", changeType: "ADD", sharesDelta: 1000, close: 200 },
          ],
        },
        {
          etfId: "00981A",
          etfName: "主動統一台股增長",
          issuer: "統一",
          entryDate: "2026-07-14",
          holdingTradingDays: 1,
          excessReturnPct: 4,
          excessReturnNote: null,
          followUps: [],
        },
      ],
    },
    {
      stockId: "NVDA US",
      stockName: "NVDA US",
      industry: null,
      etfCount: 1,
      issuerCount: 1,
      followUpCount: 0,
      entryValueTwd: null,
      addValueTwd: null,
      segment: "single_new",
      legs: [{
        etfId: "00988A",
        etfName: "主動統一全球創新",
        issuer: "統一",
        entryDate: "2026-07-14",
        holdingTradingDays: 1,
        excessReturnPct: null,
        excessReturnNote: "不適用",
        followUps: [],
      }],
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
    expect(screen.getAllByText("+12 張")).toHaveLength(2);
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
    expect(within(collective).getAllByText("排名")).toHaveLength(2);
    expect(within(collective).getAllByText("股票")).toHaveLength(2);
    expect(within(collective).getAllByText("ETF 檔數")).toHaveLength(2);
    expect(within(collective).getAllByText("合計金額")).toHaveLength(2);
    expect(within(collective).getByText("27.50 億")).toBeInTheDocument();
    expect(within(collective).getByText("—")).toBeInTheDocument();
    expect(within(collective).getByText(/再比合計金額/)).toBeInTheDocument();

    const radar = screen.getByRole("region", { name: "新倉追蹤雷達" });
    expect(within(radar).getByText("+12.33%")).toBeInTheDocument(); // |excess| >= 10 => colored
    expect(within(radar).getByText("2 檔 ETF / 2 家投信建倉，後續加碼 1 筆")).toBeInTheDocument();
    expect(within(radar).getByText(/後續加碼列為脈絡，不另計為一次建倉/)).toBeInTheDocument();
    expect(radar).toHaveClass("min-w-0");
    expect(container.querySelector("main > div")).toHaveClass("grid-cols-[minmax(0,1fr)]");
  });

  it("海外股票名稱 fallback 成代號時只顯示一次", async () => {
    const user = userEvent.setup();
    render(<TodayOverviewDashboard overview={overview} />);

    const radar = screen.getByRole("region", { name: "新倉追蹤雷達" });
    await user.click(within(radar).getByRole("tab", { name: "單 ETF 新進 1" }));
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
