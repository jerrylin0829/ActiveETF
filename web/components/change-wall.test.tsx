import { render, screen } from "@testing-library/react";
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
  event({ stockId: "A", changeType: "NEW", weightDeltaPct: 6 }),
  event({ stockId: "B", changeType: "NEW", weightDeltaPct: 5 }),
  event({ stockId: "C", changeType: "EXIT", weightDeltaPct: -4 }),
  event({ stockId: "D", changeType: "NEW", weightDeltaPct: 3 }),
  event({ stockId: "E", changeType: "EXIT", weightDeltaPct: -2 }),
  event({ stockId: "F", changeType: "NEW", weightDeltaPct: 1 }),
  event({
    stockId: "G US",
    stockName: "G US",
    changeType: "ADD",
    weightDeltaPct: 0.9,
  }),
  event({ stockId: "H", changeType: "ADD", weightDeltaPct: 0.4 }),
];

describe("ChangeWall", () => {
  it("預設顯示建倉出清與台股的前五筆", () => {
    render(<ChangeWall events={events} />);

    expect(screen.getAllByTestId("change-row")).toHaveLength(5);
    expect(screen.queryByText("F 台積電")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "查看更多（1）" }),
    ).toBeInTheDocument();
  });

  it("可展開全部並再次收合", async () => {
    const user = userEvent.setup();
    render(<ChangeWall events={events} />);

    await user.click(screen.getByRole("button", { name: "查看更多（1）" }));
    expect(screen.getAllByTestId("change-row")).toHaveLength(6);
    expect(screen.getByText("F 台積電")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "收合" }));
    expect(screen.getAllByTestId("change-row")).toHaveLength(5);
  });

  it("切換加減碼只顯示 ADD/TRIM", async () => {
    const user = userEvent.setup();
    render(<ChangeWall events={events} />);

    await user.click(screen.getByRole("button", { name: "加減碼" }));
    expect(screen.getAllByTestId("change-row")).toHaveLength(1);
    expect(screen.getByText("H 台積電")).toBeInTheDocument();
  });

  it("切換海外市場顯示海外事件且代號不重複", async () => {
    const user = userEvent.setup();
    render(<ChangeWall events={events} />);

    await user.click(screen.getByRole("button", { name: "加減碼" }));
    await user.click(screen.getByRole("button", { name: "海外" }));
    expect(screen.getByRole("link", { name: "G US" })).toBeInTheDocument();
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
