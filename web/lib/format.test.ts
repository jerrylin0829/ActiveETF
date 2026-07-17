import { describe, expect, it } from "vitest";
import { formatLots, formatPct, formatSignedPct, formatYi } from "@/lib/format";

describe("format", () => {
  it("權重以 % 呈現、最多兩位小數", () => {
    expect(formatPct(12.334)).toBe("12.33%");
    expect(formatPct(null)).toBe("—");
  });
  it("變化帶正負號", () => {
    expect(formatSignedPct(1.25)).toBe("+1.25%");
    expect(formatSignedPct(-0.866)).toBe("-0.87%");
    expect(formatSignedPct(0)).toBe("+0.00%");
    expect(formatSignedPct(null)).toBe("—");
  });
  it("金額元轉億元", () => {
    expect(formatYi(2750000000)).toBe("27.50 億");
    expect(formatYi(null)).toBe("—");
  });
  it("股數轉張數千分位", () => {
    expect(formatLots(1234000)).toBe("1,234");
  });
});
