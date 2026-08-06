import datetime as dt
import types

import pytest

from activeetf.adapters import base


def test_supports_history_true_when_fetch_at_defined():
    module = types.SimpleNamespace(fetch_at=lambda entry, date: [])
    assert base.supports_history(module) is True


def test_supports_history_false_when_absent():
    module = types.SimpleNamespace(fetch=lambda entry: [])
    assert base.supports_history(module) is False


def test_supports_history_false_when_not_callable():
    module = types.SimpleNamespace(fetch_at="not a function")
    assert base.supports_history(module) is False


# 2026-07-31 實測：六支 fetch_at 只有國泰、中信的請求日等於資料日，
# 其餘四支各差一個交易日。位移寫在 adapter 內，回補腳本據此換算請求日。

def test_history_request_offset_defaults_to_zero_for_plain_adapters():
    assert base.history_request_offset(types.SimpleNamespace()) == 0


def test_history_request_offset_reads_module_constant():
    module = types.SimpleNamespace(HISTORY_REQUEST_OFFSET=-1)
    assert base.history_request_offset(module) == -1


def test_每支_adapter_的位移與_2026_07_31_實測相符():
    offsets = {
        name: base.history_request_offset(base.load(name))
        for name in ("cathay", "ctbc", "uni", "fsitc", "allianz", "yuanta")
    }
    assert offsets == {
        "cathay": 0,    # 請求 D → 表頭 D
        "ctbc": 0,      # 請求 D → 公告日 D
        "uni": 1,       # 請求 D → TranDate D-1，故目標 T 要請求 T+1
        "fsitc": 1,     # 請求 D → sdate D-1
        "allianz": 1,   # 請求 D → CNavDt D-1
        "yuanta": -1,   # 請求 D → upddate D+1，故目標 T 要請求 T-1
    }


def test_source_offset_defaults_to_zero():
    assert base.history_source_offset(types.SimpleNamespace(), "00981A") == 0


def test_統一的全球型_00988A_的每日路徑存的是前一交易日的資料():
    """2026-07-31 實測：DB[T] 的內容等於 TranDate = T-1 的那份 PCF。

    請求位移與台股型相同（+1），但「該有的資料日」是 T-1 而不是 T——
    斷言必須照每日路徑的語意，否則整檔都會被判成日期不符。
    """
    module = base.load("uni")

    assert base.history_request_offset(module, "00988A") == 1
    assert base.history_source_offset(module, "00988A") == -1
    assert base.history_source_offset(module, "00981A") == 0
    assert base.history_source_offset(module, "00403A") == 0


# 各家日期字串格式不同，共用解析器；台北時區是必要的（見 uni 的 /Date(ms)/）

@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("2026-07-08T00:00:00", dt.date(2026, 7, 8)),
        ("2026-07-09 14:17:43", dt.date(2026, 7, 9)),
        ("2026/07/09", dt.date(2026, 7, 9)),
        ("2026-07-27", dt.date(2026, 7, 27)),
        ("/Date(1785081600000)/", dt.date(2026, 7, 27)),
    ],
)
def test_parse_upstream_date_accepts_every_observed_format(raw, expected):
    assert base.parse_upstream_date(raw) == expected


@pytest.mark.parametrize("raw", ["", None, "n/a", "/Date(abc)/"])
def test_parse_upstream_date_returns_none_rather_than_guessing(raw):
    assert base.parse_upstream_date(raw) is None


# 同一份 payload 內多列都帶日期時，必須一致才採信（混日期代表上游狀態不明）

def test_unique_upstream_date_returns_the_agreed_date():
    assert base.unique_upstream_date(
        ["2026-07-27", "2026/07/27", "2026-07-27T00:00:00"]
    ) == dt.date(2026, 7, 27)


def test_unique_upstream_date_returns_none_when_rows_disagree():
    assert base.unique_upstream_date(["2026-07-27", "2026-07-28"]) is None


def test_unique_upstream_date_ignores_unparsable_entries():
    assert base.unique_upstream_date([None, "", "2026-07-27"]) == dt.date(2026, 7, 27)


def test_unique_upstream_date_returns_none_when_nothing_parses():
    assert base.unique_upstream_date([None, "n/a"]) is None


# 同一支 adapter 底下不同 ETF 的發布時程可能不同（實測：統一的全球型 00988A
# 與台股型 00981A 差一個交易日），故位移必須可以逐檔覆寫。

def test_history_request_offset_falls_back_to_the_module_default():
    module = types.SimpleNamespace(HISTORY_REQUEST_OFFSET=1)
    assert base.history_request_offset(module, "00981A") == 1


def test_history_request_offset_prefers_the_per_etf_override():
    module = types.SimpleNamespace(
        HISTORY_REQUEST_OFFSET=1,
        HISTORY_REQUEST_OFFSETS={"00988A": 2},
    )
    assert base.history_request_offset(module, "00988A") == 2
    assert base.history_request_offset(module, "00981A") == 1


def test_history_request_offset_without_etf_id_uses_the_default():
    module = types.SimpleNamespace(HISTORY_REQUEST_OFFSET=-1)
    assert base.history_request_offset(module) == -1


def test_unique_upstream_date_rejects_when_any_present_value_is_unparsable():
    """有值卻解不出日期代表格式變了，不能靠其他列蒙混過關。"""
    assert base.unique_upstream_date(["2026-07-27", "n/a"]) is None
    assert base.unique_upstream_date(["2026-07-27", "/Date(abc)/"]) is None
