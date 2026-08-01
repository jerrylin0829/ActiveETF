import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { RadarNarrative } from "@/components/radar-narrative";
import type { RadarNarrative as RadarNarrativeModel } from "@/lib/today-overview";

const narrative = (
  overrides: Partial<RadarNarrativeModel> = {},
): RadarNarrativeModel => ({
  stockId: "3026",
  stockName: "禾伸堂",
  industry: "電子零組件業",
  etfCount: 2,
  issuerCount: 2,
  followUpCount: 2,
  entryValueTwd: 1_170_000_000,
  addValueTwd: 1_580_000_000,
  segment: "multi_add",
  legs: [
    {
      etfId: "00405A",
      etfName: "主動富邦台灣龍耀",
      issuer: "富邦",
      entryDate: "2026-07-06",
      holdingTradingDays: 8,
      excessReturnPct: -19.21,
      excessReturnNote: null,
      followUps: [
        { tradeDate: "2026-07-13", changeType: "ADD", sharesDelta: 1000, close: 100 },
        { tradeDate: "2026-07-14", changeType: "TRIM", sharesDelta: -500, close: 98 },
      ],
    },
    {
      etfId: "00991A",
      etfName: "主動復華未來50",
      issuer: "復華",
      entryDate: "2026-07-07",
      holdingTradingDays: 7,
      excessReturnPct: null,
      excessReturnNote: "—",
      followUps: [],
    },
  ],
  ...overrides,
});

const narratives: RadarNarrativeModel[] = [
  narrative(),
  narrative({
    stockId: "2330",
    stockName: "台積電",
    etfCount: 1,
    issuerCount: 1,
    followUpCount: 1,
    segment: "single_add",
    legs: [
      {
        ...narrative().legs[0],
        etfId: "00981A",
        etfName: "主動統一台股增長",
        excessReturnPct: 12.34,
      },
    ],
  }),
  narrative({ stockId: "2317", stockName: "鴻海", followUpCount: 0, segment: "multi_new" }),
  narrative({
    stockId: "NVDA US",
    stockName: "NVIDIA",
    industry: null,
    etfCount: 1,
    issuerCount: 1,
    followUpCount: 0,
    entryValueTwd: null,
    addValueTwd: null,
    segment: "single_new",
    legs: [{
      ...narrative().legs[0],
      etfId: "00990A",
      etfName: "主動元大AI新經濟",
      excessReturnPct: null,
      excessReturnNote: "不適用",
      followUps: [],
    }],
  }),
];

describe("RadarNarrative", () => {
  it("renders stock-group context and keeps excess returns on ETF legs only", () => {
    render(<RadarNarrative narratives={narratives} />);

    const card = screen.getByTestId("radar-narrative-3026");
    expect(within(card).getByRole("link", { name: "3026 禾伸堂" })).toHaveAttribute(
      "href",
      "/stock/3026",
    );
    expect(within(card).getByText("電子零組件業")).toBeInTheDocument();
    expect(within(card).getByText("2 檔 ETF / 2 家投信建倉，後續加碼 2 筆")).toBeInTheDocument();
    expect(within(card).getByText("估算新進 11.70 億")).toBeInTheDocument();
    expect(within(card).getByText("估算加碼 15.80 億")).toBeInTheDocument();
    expect(within(card).getByText("-19.21%")).toHaveClass("text-[var(--market-down)]");
    expect(within(card).getByText("—")).toBeInTheDocument();
    expect(card).not.toHaveTextContent("平均超額");
  });

  it("shows chronological ADD/TRIM context with Taiwan market colors and the entry-definition note", () => {
    render(<RadarNarrative narratives={narratives} />);

    const timeline = screen.getByRole("list", { name: "00405A 建倉脈絡" });
    const events = within(timeline).getAllByRole("listitem");
    expect(events.map((event) => event.textContent)).toEqual([
      "7/6 建倉",
      "7/13 加碼",
      "7/14 減碼",
    ]);
    expect(events[1]).toHaveClass("text-[var(--market-up)]");
    expect(events[2]).toHaveClass("text-[var(--market-down)]");
    expect(screen.getByText(/後續加碼列為脈絡，不另計為一次建倉/)).toBeInTheDocument();
    expect(screen.getByText(/已濾除申贖造成的等比例變動/)).toBeInTheDocument();
  });

  it("filters all four mutually exclusive segments and shows their stock counts", async () => {
    const user = userEvent.setup();
    render(<RadarNarrative narratives={narratives} />);

    const tabs = screen.getByRole("tablist", { name: "雷達分類" });
    expect(within(tabs).getByRole("tab", { name: "多 ETF 追買 1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(tabs).getByRole("tab", { name: "單 ETF 追買 1" })).toBeInTheDocument();
    expect(within(tabs).getByRole("tab", { name: "多 ETF 新進 1" })).toBeInTheDocument();
    expect(within(tabs).getByRole("tab", { name: "單 ETF 新進 1" })).toBeInTheDocument();
    expect(screen.getAllByTestId(/^radar-narrative-/)).toHaveLength(1);

    await user.click(within(tabs).getByRole("tab", { name: "單 ETF 新進 1" }));
    const overseas = screen.getByTestId("radar-narrative-NVDA US");
    expect(overseas).toBeInTheDocument();
    expect(within(overseas).getByText("未分類")).toBeInTheDocument();
    expect(overseas).toHaveTextContent("估算新進 —");
    expect(overseas).toHaveTextContent("估算加碼 —");
    expect(overseas).toHaveTextContent("不適用");
  });

  it("links tabs to their panel and supports arrow-key navigation", async () => {
    const user = userEvent.setup();
    render(<RadarNarrative narratives={narratives} />);

    const multiAdd = screen.getByRole("tab", { name: "多 ETF 追買 1" });
    const singleAdd = screen.getByRole("tab", { name: "單 ETF 追買 1" });
    const panel = screen.getByRole("tabpanel");
    expect(multiAdd).toHaveAttribute("aria-controls", "radar-narrative-panel");
    expect(panel).toHaveAttribute("aria-labelledby", "radar-tab-multi_add");
    expect(multiAdd).toHaveAttribute("tabindex", "0");
    expect(singleAdd).toHaveAttribute("tabindex", "-1");

    multiAdd.focus();
    await user.keyboard("{ArrowRight}");

    expect(singleAdd).toHaveFocus();
    expect(singleAdd).toHaveAttribute("aria-selected", "true");
    expect(panel).toHaveAttribute("aria-labelledby", "radar-tab-single_add");
    expect(screen.getByTestId("radar-narrative-2330")).toBeInTheDocument();
  });

  it("shows five stock groups before expanding the rest", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 6 }, (_, index) =>
      narrative({ stockId: String(3000 + index), stockName: `股票 ${index + 1}` }),
    );
    render(<RadarNarrative narratives={many} />);

    expect(screen.getAllByTestId(/^radar-narrative-/)).toHaveLength(5);
    expect(screen.queryByTestId("radar-narrative-3005")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "查看更多（1）" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "radar-narrative-list");

    await user.click(toggle);
    expect(screen.getAllByTestId(/^radar-narrative-/)).toHaveLength(6);
    expect(screen.getByTestId("radar-narrative-3005")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收合" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("shows an explicit incomplete state instead of empty radar results", () => {
    render(
      <RadarNarrative
        narratives={[]}
        error="新倉雷達事件讀取不完整：radar page 2 failed"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("雷達資料讀取不完整");
    expect(screen.getByRole("alert")).toHaveTextContent("暫不顯示分類與金額");
    expect(screen.queryByText("此分類目前沒有符合雷達條件的新倉。")).not.toBeInTheDocument();
  });
});
