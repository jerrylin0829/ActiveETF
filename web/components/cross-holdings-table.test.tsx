import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CrossHoldingsTable } from "@/components/cross-holdings-table";
import type { CrossDetail, CrossRow } from "@/lib/cross-holdings";

const rows: CrossRow[] = [
  {
    stockId: "2330",
    stockName: "台積電",
    industry: "半導體業",
    etfCount: 5,
    totalWeightPct: 30.125,
    totalShares: 5000000,
    totalValueTwd: 5e9,
    newCount: 0,
    addCount: 2,
    trimCount: 1,
    exitCount: 0,
  },
  {
    stockId: "1101",
    stockName: "台泥",
    industry: "水泥工業",
    etfCount: 1,
    totalWeightPct: 2.5,
    totalShares: 1000000,
    totalValueTwd: null,
    newCount: 0,
    addCount: 0,
    trimCount: 0,
    exitCount: 0,
  },
];

const details: Record<string, CrossDetail[]> = {
  "2330": [
    {
      etfId: "00981A",
      etfName: "主動統一台股增長",
      weightPct: 9.31,
      shares: 1000000,
      changeType: "ADD",
    },
  ],
};

describe("CrossHoldingsTable", () => {
  it("預設依涵蓋檔數降冪並照規範格式化", () => {
    render(<CrossHoldingsTable rows={rows} details={details} />);
    const bodyRows = screen.getAllByTestId("cross-row");
    expect(within(bodyRows[0]).getByText(/台積電/)).toBeInTheDocument();
    expect(within(bodyRows[0]).getByText("30.13%")).toBeInTheDocument();
    expect(within(bodyRows[0]).getByText("50.00 億")).toBeInTheDocument();
    expect(within(bodyRows[1]).getByText("—")).toBeInTheDocument(); // missing price
  });

  it("異動徽章只在有事件時出現", () => {
    render(<CrossHoldingsTable rows={rows} details={details} />);
    expect(screen.getByText("加碼×2")).toBeInTheDocument();
    expect(screen.getByText("減碼×1")).toBeInTheDocument();
    expect(screen.queryByText("新進×0")).not.toBeInTheDocument();
  });

  it("獨門篩選只留涵蓋檔數 1 的列", async () => {
    const user = userEvent.setup();
    render(<CrossHoldingsTable rows={rows} details={details} />);
    await user.selectOptions(screen.getByLabelText("涵蓋檔數"), "only1");
    expect(screen.queryByText(/台積電/)).not.toBeInTheDocument();
    expect(screen.getByText(/台泥/)).toBeInTheDocument();
  });

  it("點列展開該股的 ETF 明細", async () => {
    const user = userEvent.setup();
    render(<CrossHoldingsTable rows={rows} details={details} />);
    await user.click(screen.getAllByTestId("cross-row")[0]);
    expect(screen.getByText(/主動統一台股增長/)).toBeInTheDocument();
    expect(screen.getByText("9.31%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /00981A 主動統一台股增長/ })).toHaveAttribute(
      "href",
      "/etf/00981A",
    );
  });

  it("股票名稱連到個股反查頁且不切換展開狀態", async () => {
    const user = userEvent.setup();
    render(<CrossHoldingsTable rows={rows} details={details} />);

    const stockLink = screen.getByRole("link", { name: /2330.*台積電/ });
    expect(stockLink).toHaveAttribute("href", "/stock/2330");
    stockLink.addEventListener("click", (event) => event.preventDefault());
    await user.click(stockLink);
    expect(screen.queryByText(/主動統一台股增長/)).not.toBeInTheDocument();
  });

  it("空資料顯示空狀態", () => {
    render(<CrossHoldingsTable rows={[]} details={{}} />);
    expect(screen.getByText(/該日無資料/)).toBeInTheDocument();
  });
});
