import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StockEventHistory } from "@/components/stock-lookup/stock-event-history";

describe("StockEventHistory", () => {
  it("orders dates newest first and renders ETF links with market colors", () => {
    render(
      <StockEventHistory
        events={[
          {
            tradeDate: "2026-07-20",
            etfId: "00981A",
            etfName: "主動統一台股增長",
            changeType: "TRIM",
            sharesDelta: -2_000,
            weightDeltaPct: -0.25,
          },
          {
            tradeDate: "2026-07-21",
            etfId: "00980A",
            etfName: "主動野村臺灣優選",
            changeType: "NEW",
            sharesDelta: 1_000,
            weightDeltaPct: 1.2,
          },
        ]}
      />,
    );

    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "2026-07-21",
      "2026-07-20",
    ]);
    expect(screen.getByText("NEW")).toHaveClass("text-red-700");
    expect(screen.getByText("TRIM")).toHaveClass("text-emerald-700");
    const newest = screen.getAllByRole("listitem")[1];
    expect(within(newest).getByRole("link", { name: /00980A.*主動野村臺灣優選/ })).toHaveAttribute(
      "href",
      "/etf/00980A",
    );
    expect(screen.getByText("+1,000 股")).toBeInTheDocument();
    expect(screen.getByText("-0.25%")).toBeInTheDocument();
  });

  it("renders an empty state", () => {
    render(<StockEventHistory events={[]} />);
    expect(screen.getByText("最近 30 個交易日沒有異動事件")).toBeInTheDocument();
  });
});
