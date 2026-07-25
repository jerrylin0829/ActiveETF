import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ChangeWall } from "@/components/change-wall";
import type { ChangeEvent } from "@/lib/today-overview";

const base: ChangeEvent = {
  etfId: "00981A",
  etfName: "主動統一台股增長",
  issuer: "統一",
  tradeDate: "2026-07-22",
  stockId: "2330",
  stockName: "台積電",
  changeType: "NEW",
  sharesDelta: 1000,
  weightDeltaPct: 0.5,
};

const event = (overrides: Partial<ChangeEvent>): ChangeEvent => ({
  ...base,
  ...overrides,
});

const events: ChangeEvent[] = [
  event({ stockId: "A", changeType: "NEW", sharesDelta: 6000, weightDeltaPct: 0.6 }),
  event({ stockId: "B", changeType: "NEW", sharesDelta: 5000, weightDeltaPct: 0.5 }),
  event({ stockId: "C", changeType: "EXIT", sharesDelta: -4000, weightDeltaPct: -0.4 }),
  event({ stockId: "D", changeType: "NEW", sharesDelta: 3000, weightDeltaPct: 0.3 }),
  event({ stockId: "E", changeType: "EXIT", sharesDelta: -2000, weightDeltaPct: -0.2 }),
  event({ stockId: "F", changeType: "NEW", sharesDelta: 1000, weightDeltaPct: 0.1 }),
  event({
    stockId: "G US",
    stockName: "G US",
    changeType: "ADD",
    sharesDelta: 1120,
    weightDeltaPct: 0.9,
  }),
  event({ stockId: "H", changeType: "ADD", sharesDelta: 4000, weightDeltaPct: 0.4 }),
];

describe("ChangeWall", () => {
  it("預設顯示前五個股票分組並以剩餘組數展開", async () => {
    const user = userEvent.setup();
    render(
      <ChangeWall
        events={[
          ...events,
          event({
            etfId: "00980A",
            stockId: "A",
            sharesDelta: 1000,
            weightDeltaPct: 0.05,
          }),
        ]}
      />,
    );

    expect(screen.getAllByTestId("change-group")).toHaveLength(5);
    expect(screen.queryByRole("link", { name: "F 台積電" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看更多（1）" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "查看更多（1）" }));
    expect(screen.getAllByTestId("change-group")).toHaveLength(6);
    expect(screen.getByRole("link", { name: "F 台積電" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "收合" }));
    expect(screen.getAllByTestId("change-group")).toHaveLength(5);
  });

  it("依股票分組、彙總股數，並把事件徽章放在 ETF 之前", () => {
    render(
      <ChangeWall
        events={[
          event({
            etfId: "00991A",
            etfName: "主動復華未來50",
            sharesDelta: 4800000,
            weightDeltaPct: 1.25,
          }),
          event({
            etfId: "00981A",
            etfName: "主動統一台股增長",
            changeType: "EXIT",
            sharesDelta: -1500000,
            weightDeltaPct: -0.42,
          }),
        ]}
      />,
    );

    const group = screen.getByTestId("change-group");
    expect(within(group).getByRole("link", { name: "2330 台積電" })).toBeInTheDocument();
    expect(group).toHaveTextContent("2 檔 ETF · 合計 +3,300 張");
    expect(within(group).getByText("+4,800 張")).toBeInTheDocument();
    expect(within(group).getByText("-1,500 張")).toBeInTheDocument();
    expect(within(group).getByText("+1.25%")).toBeInTheDocument();

    const firstRow = within(group).getAllByTestId("change-row")[0];
    const badge = within(firstRow).getByText("NEW");
    const etfLink = within(firstRow).getByRole("link", {
      name: "00991A 主動復華未來50",
    });
    expect(
      badge.compareDocumentPosition(etfLink) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("顯示欄位標題與單位說明", () => {
    render(<ChangeWall events={events} />);

    expect(screen.getByText("股票 · 異動 ETF")).toBeInTheDocument();
    expect(screen.getByText("股數")).toBeInTheDocument();
    expect(screen.getByText("比例")).toBeInTheDocument();
    expect(screen.getByText(/台股股數以張、海外股數以股顯示/)).toBeInTheDocument();
  });

  it("可切換 ETF 檔數與單筆幅度排序", async () => {
    const user = userEvent.setup();
    render(
      <ChangeWall
        events={[
          event({ etfId: "A", stockId: "2330", weightDeltaPct: 0.6 }),
          event({ etfId: "B", stockId: "2330", weightDeltaPct: 0.4 }),
          event({ etfId: "C", stockId: "2454", stockName: "聯發科", weightDeltaPct: 2 }),
        ]}
      />,
    );

    expect(within(screen.getAllByTestId("change-group")[0]).getByText(/2330 台積電/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "單筆幅度" }));
    expect(within(screen.getAllByTestId("change-group")[0]).getByText(/2454 聯發科/)).toBeInTheDocument();
  });

  it("切換加減碼只顯示 ADD/TRIM", async () => {
    const user = userEvent.setup();
    render(<ChangeWall events={events} />);

    await user.click(screen.getByRole("button", { name: "加減碼" }));
    expect(screen.getAllByTestId("change-group")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "H 台積電" })).toBeInTheDocument();
  });

  it("切換海外市場顯示海外股數且代號不重複", async () => {
    const user = userEvent.setup();
    render(<ChangeWall events={events} />);

    await user.click(screen.getByRole("button", { name: "加減碼" }));
    await user.click(screen.getByRole("button", { name: "海外" }));
    expect(screen.getByRole("link", { name: "G US" })).toBeInTheDocument();
    expect(screen.getAllByText("+1,120 股")).toHaveLength(2);
  });

  it("顯示事件圖例與資料批次說明", () => {
    render(<ChangeWall events={events} />);

    expect(screen.getByText(/列出選定交易日/)).toBeInTheDocument();
    expect(screen.getByText(/首次買進/)).toBeInTheDocument();
  });

  it("空分類顯示當日無異動", async () => {
    const user = userEvent.setup();
    render(<ChangeWall events={[event({ stockId: "2330" })]} />);

    await user.click(screen.getByRole("button", { name: "海外" }));
    expect(screen.getByText("此分類當日無異動。")).toBeInTheDocument();
  });
});
