"""One-off probe: which 投信 PCF endpoints serve *historical* holdings?

Read-only diagnostic. For each adapter whose upstream request carries a date
parameter, fetch the latest snapshot plus two past dates and compare
fingerprints. A house counts as SUPPORTED only when a past date returns data
that DIFFERS from the latest — an endpoint that silently ignores the date and
echoes today's holdings is not usable for backfill.

Politeness: one representative ETF per house, <=3 requests each, 2s apart.
Never run this in CI; it is a manual research tool.

Usage:  uv run python scripts/probe_history.py
"""
import datetime as dt
import time
import traceback

import requests

from activeetf.adapters import allianz, cathay, ctbc, fsitc, nomura, uni, yuanta
from activeetf.adapters.base import UA
from activeetf.models import Holding

# Near probe: ~1 month back, valid for every ETF here. The "far" probe must be
# per-ETF — a date before an ETF's listing legitimately returns empty and would
# otherwise be misread as "history unavailable".
NEAR = dt.date(2026, 6, 15)
PAUSE = 2.0

# Houses whose upstream request has no date parameter at all — listed so the
# report covers all 15 adapters, not just the probe-able ones.
NO_DATE_PARAM = {
    "ab": "GET /{isin}/holdings，無日期參數",
    "capital": "POST {fundId} only，無日期參數",
    "fubon": "GET 靜態頁 stkId，無日期參數",
    "fuhua": "下載當期 xlsx，無日期參數",
    "jpm": "下載當期 xlsx，無日期參數",
    "kgi": "GET 靜態頁，無日期參數",
    "mega": "ASP.NET postback；表單內或有日期欄，需人工確認",
    "tsit": "GET 靜態頁，無日期參數",
}


def _roc(d: dt.date) -> str:
    return f"{d.year - 1911:03d}/{d.month:02d}/{d.day:02d}"


def probe_uni(d: dt.date | None) -> list[Holding]:
    s = requests.Session()
    s.get("https://www.ezmoney.com.tw/ETF/Transaction/PCF", headers=UA,
          timeout=30, allow_redirects=False)
    body = {"fundCode": "63YTW",
            "date": _roc(d or dt.date.today()),
            "specificDate": d is not None}
    r = s.post("https://www.ezmoney.com.tw/ETF/Transaction/GetPCF", json=body,
               headers=UA, timeout=30)
    r.raise_for_status()
    return uni.parse(r.json())


def probe_yuanta(d: dt.date | None) -> list[Holding]:
    params = {"APIType": "ETFAPI", "CompanyName": "YUANTAFUNDS",
              "PageName": "/tradeInfo/pcf/00990A", "DeviceId": "null",
              "FuncId": "PCF/Daily", "AppName": "ETF", "Device": "3",
              "Platform": "ETF", "ticker": "00990A",
              "ndate": d.strftime("%Y%m%d") if d else ""}
    r = requests.get("https://etfapi.yuantaetfs.com/ectranslation/api/bridge",
                     headers=UA, params=params, timeout=30)
    r.raise_for_status()
    return yuanta.parse(r.json())


def _entry(etf_id: str):
    from activeetf.registry import entries
    return next(e for e in entries() if e.etf_id == etf_id)


def probe_cathay(d: dt.date | None) -> list[Holding]:
    from activeetf.adapters.cathay import _API_BASE, _FUND_CODES
    code = _FUND_CODES["00400A"]
    if d is None:
        info = requests.get(f"{_API_BASE}/GetETFInfoMain",
                            params={"FundCode": code, "status": 1},
                            headers=UA, timeout=30)
        info.raise_for_status()
        search = info.json()["result"]["navDate"].replace("/", "-")
    else:
        search = d.isoformat()
    wb = requests.get(f"{_API_BASE}/DownloadETFWeightExcel",
                      params={"FundCode": code, "SearchDate": search, "status": 1},
                      headers=UA, timeout=30)
    wb.raise_for_status()
    return cathay.parse_xlsx(wb.content)


def probe_fsitc(d: dt.date | None) -> list[Holding]:
    from urllib.parse import urljoin
    from activeetf.adapters.fsitc import _fund_id
    entry = _entry("00994A")
    r = requests.post(urljoin(entry.pcf_url, "WebAPI.aspx/Get_hd"),
                      json={"pStrFundID": _fund_id(entry.pcf_url),
                            "pStrDate": d.strftime("%Y/%m/%d") if d else ""},
                      headers={**UA, "Referer": entry.pcf_url}, timeout=30)
    r.raise_for_status()
    return fsitc.parse(r.json())


def probe_ctbc(d: dt.date | None) -> list[Holding]:
    from activeetf.adapters.ctbc import _API_BASE, _FUND_IDS, _TOKEN_SEED, _data
    h = {**UA, "content-type": "application/json; charset=utf-8"}
    tok = requests.post(f"{_API_BASE}/home/AuthToken", params={"token": _TOKEN_SEED},
                        json={"token": _TOKEN_SEED}, headers=h, timeout=30)
    tok.raise_for_status()
    token = _data(tok)["token"]
    # token 必須同時放 query string 與 body，缺一即回空（2026-07-25 探測踩過的坑）
    r = requests.post(f"{_API_BASE}/etf/Buyback",
                      params={"token": token},
                      json={"token": token, "FID": _FUND_IDS["00406A"],
                            "StartDate": (d or dt.date.today()).isoformat()},
                      headers=h, timeout=30)
    r.raise_for_status()
    return ctbc.parse(_data(r))


def probe_allianz(d: dt.date | None) -> list[Holding]:
    from activeetf.adapters.allianz import _API_BASE, _FUND_IDS, _ORIGIN
    entry = _entry("00402A")
    s = requests.Session()
    h = {**UA, "Origin": _ORIGIN, "Referer": entry.pcf_url or f"{_ORIGIN}/list-trade"}
    t = s.get(f"{_API_BASE}/AntiForgery/GetAntiForgeryToken", headers=h, timeout=30)
    t.raise_for_status()
    r = s.post(f"{_API_BASE}/Fund/GetFundTradeInfo",
               headers={**h, "Content-Type": "application/json",
                        "X-XSRF-TOKEN": s.cookies["X-XSRF-TOKEN"]},
               json={"FundNo": _FUND_IDS["00402A"],
                     "Date": d.isoformat() if d else None},
               timeout=30)
    r.raise_for_status()
    return allianz.parse(r.json())


def probe_nomura(d: dt.date | None) -> list[Holding]:
    from activeetf.adapters.nomura import _API_BASE, _request_body
    entry = _entry("00980A")
    h = {**UA, "Accept": "application/json", "Content-Type": "application/json"}
    if d is None:
        latest = requests.post(f"{_API_BASE}/Fund/GetFundTradeInfoDate",
                               json=_request_body(entry), headers=h, timeout=30)
        latest.raise_for_status()
        date_str = latest.json()["Entries"]["LatestDate"]
    else:
        date_str = d.isoformat()
    r = requests.post(f"{_API_BASE}/Fund/GetFundTradeInfo",
                      json=_request_body(entry, date_str), headers=h, timeout=30)
    r.raise_for_status()
    return nomura.parse(r.json())


# (代表 ETF, probe fn, 上市日, far 探測日 = 上市後約兩週)
PROBES = {
    "uni（統一）": ("00403A", probe_uni, dt.date(2026, 4, 28), dt.date(2026, 5, 12)),
    "yuanta（元大）": ("00990A", probe_yuanta, dt.date(2025, 12, 2), dt.date(2025, 12, 15)),
    "cathay（國泰）": ("00400A", probe_cathay, dt.date(2026, 3, 30), dt.date(2026, 4, 14)),
    "fsitc（第一金）": ("00994A", probe_fsitc, dt.date(2025, 12, 29), dt.date(2026, 1, 13)),
    "ctbc（中信）": ("00406A", probe_ctbc, dt.date(2026, 6, 2), dt.date(2026, 6, 16)),
    # 註：非交易日（週末）所有家皆回空，探測請挑交易日執行
    "allianz（安聯）": ("00402A", probe_allianz, dt.date(2026, 6, 1), dt.date(2026, 6, 15)),
    "nomura（野村）": ("00980A", probe_nomura, dt.date(2025, 5, 16), dt.date(2025, 6, 16)),
}


def fingerprint(holdings: list[Holding]) -> str:
    if not holdings:
        return "空"
    top = sorted(holdings, key=lambda h: -h.weight_pct)[0]
    return f"{len(holdings)}檔/{top.stock_id}:{top.shares}"


def main() -> None:
    print(f"近期探測日：{NEAR}；遠期探測日：各檔上市後約兩週（見括號）\n")
    print(f"{'投信':16} {'最新':22} {'近期':22} {'上市初期':22} 結論")
    print("-" * 104)
    for name, (etf_id, fn, listed, far) in PROBES.items():
        cells, err = [], None
        for d in (None, NEAR, far):
            try:
                cells.append(fingerprint(fn(d)))
            except Exception as ex:
                cells.append("ERR")
                err = err or f"{type(ex).__name__}: {str(ex)[:55]}"
            time.sleep(PAUSE)
        latest, near, deep = cells
        if latest in ("ERR", "空"):
            # 最新都取不到 => 探測腳本或上游有問題，不能推論該家是否支援歷史
            verdict = f"⚠️ 探測失敗，無法判定（{err or '最新回空'}）"
        elif near == "ERR":
            verdict = f"⚠️ 歷史日錯誤（{err}）"
        elif near == latest:
            verdict = "❌ 日期被忽略（回傳最新）"
        elif near == "空":
            verdict = "❌ 歷史日回空"
        elif deep not in ("ERR", "空"):
            verdict = "✅ 支援歷史，可回溯至上市初期"
        else:
            verdict = "✅ 支援歷史（上市初期未驗證）"
        print(f"{name:16} {latest:22} {near:22} {deep:22} {verdict}  [{etf_id} 上市 {listed}]")

    print("\n── 無日期參數（需人工確認或不可回補）──")
    for k, v in NO_DATE_PARAM.items():
        print(f"  {k:10} {v}")


if __name__ == "__main__":
    main()
