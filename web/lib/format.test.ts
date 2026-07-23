import { describe, expect, it } from "vitest";
import { formatLots, formatPct, formatSignedPct, formatYi, stockMarket } from "@/lib/format";

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

describe("stockMarket", () => {
  it("純數字台股代號為 tw", () => {
    expect(stockMarket("2330")).toBe("tw");
    expect(stockMarket("6488")).toBe("tw");
  });

  it("結尾兩字母交易所後綴為 overseas", () => {
    expect(stockMarket("MRVL US")).toBe("overseas");
    expect(stockMarket("00660 KS")).toBe("overseas");
    expect(stockMarket("285A JP")).toBe("overseas");
    expect(stockMarket("2330 TT")).toBe("overseas");
  });

  it("無空格後綴的英文 ticker 仍視為 tw", () => {
    expect(stockMarket("HUBS")).toBe("tw");
  });
});
