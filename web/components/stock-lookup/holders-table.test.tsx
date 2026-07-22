import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HoldersTable } from "@/components/stock-lookup/holders-table";
import type { StockHolderRow } from "@/lib/stock-lookup";

const rows: StockHolderRow[] = [
  {
    etfId: "00981A",
    etfName: "主動統一台股增長",
    shares: 12_500,
    weightPct: 10.25,
    changeType: "ADD",
    entryDate: "2026-06-01",
    holdingDays: 20,
    isLongHeld: true,
  },
  {
    etfId: "00989A",
    etfName: "主動海外成長",
    shares: 1_000,
    weightPct: 3,
    changeType: null,
    entryDate: null,
    holdingDays: null,
    isLongHeld: false,
  },
];

describe("HoldersTable", () => {
  it("renders ETF links, formatted values, changes and holding days", () => {
    render(<HoldersTable rows={rows} latestDate="2026-07-21" />);

    const holderRows = screen.getAllByTestId("stock-holder-row");
    expect(within(holderRows[0]).getByRole("link", { name: /00981A.*主動統一台股增長/ })).toHaveAttribute(
      "href",
      "/etf/00981A",
    );
    expect(within(holderRows[0]).getByText("10.25%")).toBeInTheDocument();
    expect(within(holderRows[0]).getByText("13")).toBeInTheDocument();
    expect(within(holderRows[0]).getByText("ADD")).toHaveClass("text-red-700");
    expect(within(holderRows[0]).getByText("20 天")).toBeInTheDocument();
    expect(within(holderRows[0]).getByText("長抱")).toBeInTheDocument();
    expect(within(holderRows[1]).getAllByText("—")).toHaveLength(2);
  });

  it("renders a current empty state", () => {
    render(<HoldersTable rows={[]} latestDate="2026-07-21" />);
    expect(screen.getByText("最新交易日沒有主動 ETF 持有此股票")).toBeInTheDocument();
  });
});
