import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { RankingsTable } from "@/components/rankings-table";
import type { RankingRow } from "@/lib/rankings";

const rows: RankingRow[] = [
  {
    etfId: "00980A",
    name: "主動野村臺灣優選",
    issuer: "野村投信",
    tradeDate: "2026-07-10",
    ret1m: 0.042,
    ret3m: 0.021,
    ret6m: null,
    ret1y: null,
    retInception: 0.086,
    bench00501m: 0.018,
    bench00503m: 0.031,
    bench00506m: null,
    bench00501y: null,
    bench0050Inception: 0.05,
    timingWins: 8,
    timingMonths: 12,
    pickingRealizedWins: 6,
    pickingRealizedTotal: 8,
    pickingOpenWins: 7,
    pickingOpenTotal: 12,
    medianHoldingDays: 18,
    weeklyTurnoverPct: 4.8,
  },
  {
    etfId: "00982A",
    name: "主動群益台灣強棒",
    issuer: "群益投信",
    tradeDate: "2026-07-10",
    ret1m: -0.012,
    ret3m: 0.055,
    ret6m: null,
    ret1y: null,
    retInception: 0.04,
    bench00501m: -0.03,
    bench00503m: 0.031,
    bench00506m: null,
    bench00501y: null,
    bench0050Inception: 0.03,
    timingWins: 2,
    timingMonths: 6,
    pickingRealizedWins: 3,
    pickingRealizedTotal: 12,
    pickingOpenWins: 0,
    pickingOpenTotal: 0,
    medianHoldingDays: 31,
    weeklyTurnoverPct: 1.6,
  },
];

describe("RankingsTable", () => {
  it("renders a visible data gap state without rows", () => {
    render(<RankingsTable rows={[]} />);

    expect(screen.getByRole("alert")).toHaveTextContent("資料缺口");
    expect(screen.getByText(/目前尚無 ETF 指標快取資料/)).toBeInTheDocument();
  });

  it("renders samples, benchmark values, and insufficient badges", () => {
    render(<RankingsTable rows={rows} />);

    expect(screen.getByText("00980A")).toBeInTheDocument();
    expect(screen.getByText("+4.20%")).toBeInTheDocument();
    expect(screen.getByText("0050 +1.80%")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("ranking-00980A-retInception")).getByText("0050 +5.00%"),
    )
      .toBeInTheDocument();
    expect(screen.queryByText("無同期基準")).not.toBeInTheDocument();
    expect(screen.getByText("67%（8/12）")).toBeInTheDocument();
    expect(screen.getByText("樣本不足")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(
      "此為訊號品質指標，未計部位大小，不等於績效貢獻",
    );
    expect(screen.getByRole("note")).toHaveTextContent(
      "日內沖銷不會出現在每日 PCF 快照中，無從計分",
    );
    expect(screen.getByRole("link", { name: /00980A 主動野村臺灣優選/ })).toHaveAttribute(
      "href",
      "/etf/00980A",
    );
  });

  it("renders data-gap warnings even when ranking rows exist", () => {
    render(
      <RankingsTable
        rows={rows}
        warnings={[
          {
            title: "近期爬蟲失敗",
            description: "00982A 2026-07-10：PCF 解析失敗。",
          },
        ]}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("近期爬蟲失敗");
    expect(screen.getByText("00982A")).toBeInTheDocument();
  });

  it("sorts by return columns when the header button is clicked", async () => {
    const user = userEvent.setup();
    render(<RankingsTable rows={rows} />);

    const bodyRows = screen.getAllByRole("row").slice(1);
    expect(within(bodyRows[0]).getByText("00980A")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "1個月報酬排序" }));

    const resortedRows = screen.getAllByRole("row").slice(1);
    expect(within(resortedRows[0]).getByText("00982A")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "1個月報酬排序" }));

    const restoredRows = screen.getAllByRole("row").slice(1);
    expect(within(restoredRows[0]).getByText("00980A")).toBeInTheDocument();
  });
});
