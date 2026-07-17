import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RotationDashboard } from "@/components/rotation-dashboard";
import type { IndustryDaily } from "@/lib/rotation";

const rows: IndustryDaily[] = [];
for (const [date, semi, fin] of [
  ["2026-07-10", 80, 20],
  ["2026-07-11", 84, 16],
  ["2026-07-14", 90, 10],
] as const) {
  rows.push(
    { tradeDate: date, industry: "半導體業", sumWeightPct: semi, stockCount: 3, etfCountTotal: 2 },
    {
      tradeDate: date,
      industry: "金融保險業",
      sumWeightPct: fin,
      stockCount: 2,
      etfCountTotal: 2,
    },
  );
}

describe("RotationDashboard", () => {
  it("表格依當日平均權重降冪、格式照規範", () => {
    render(<RotationDashboard rows={rows} />);
    const bodyRows = screen.getAllByTestId("rotation-row");
    expect(within(bodyRows[0]).getByText("半導體業")).toBeInTheDocument();
    expect(within(bodyRows[0]).getByText("45.00%")).toBeInTheDocument();
  });

  it("資料不足 N 日時變化欄顯示破折號", () => {
    render(<RotationDashboard rows={rows} />);
    // only 3 trading days of data -> both 5-day and 20-day changes are null
    const bodyRows = screen.getAllByTestId("rotation-row");
    expect(within(bodyRows[0]).getAllByText("—").length).toBe(2);
  });

  it("點表格列切換圖上勾選狀態", async () => {
    const user = userEvent.setup();
    render(<RotationDashboard rows={rows} />);
    const row = screen.getAllByTestId("rotation-row")[1];
    expect(row).toHaveAttribute("data-selected", "true"); // top-6 default includes it
    await user.click(row);
    expect(row).toHaveAttribute("data-selected", "false");
  });

  it("空資料顯示空狀態", () => {
    render(<RotationDashboard rows={[]} />);
    expect(screen.getByText(/尚無彙總資料/)).toBeInTheDocument();
  });

  it("時間範圍透過 URL 重新查詢 server，並標示目前範圍", () => {
    render(<RotationDashboard rows={rows} range="6M" />);

    expect(screen.getByRole("link", { name: "6M" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "1M" })).toHaveAttribute(
      "href",
      "/rotation?range=1M",
    );
  });

  it("沒有 ResizeObserver 時仍依容器寬度顯示單日資料 marker", async () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
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
    try {
      render(<RotationDashboard rows={rows.slice(0, 2)} />);

      await waitFor(() => expect(document.querySelector(".recharts-surface")).toBeInTheDocument());
      await waitFor(() =>
        expect(document.querySelectorAll(".recharts-reference-dot-dot").length).toBeGreaterThan(0),
      );
    } finally {
      rectSpy.mockRestore();
    }
  });
});
