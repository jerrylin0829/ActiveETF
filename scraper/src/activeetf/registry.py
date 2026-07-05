"""ETF ↔ 投信 ↔ adapter ↔ PCF URL 對照。
新 ETF 上市：同投信加一行；新投信：寫新 adapter（見 CLAUDE.md 預定 skill new-adapter）。
adapter=None 表示尚未實作——pipeline 會跳過並記 fail，Dashboard 黃條可見。"""
from dataclasses import dataclass


@dataclass(frozen=True)
class EtfEntry:
    etf_id: str
    name: str
    issuer: str
    universe: str        # 'tw' | 'global'
    pcf_url: str | None
    adapter: str | None  # adapters/ 下的模組名


REGISTRY: list[EtfEntry] = [
    EtfEntry("00400A", "主動國泰動能高息", "國泰", "tw", None, None),
    EtfEntry("00401A", "主動摩根台灣鑫收", "摩根", "tw", None, None),
    EtfEntry("00402A", "主動安聯美國科技", "安聯", "global", None, None),
    EtfEntry("00403A", "主動統一升級50", "統一", "tw", None, None),
    EtfEntry("00404A", "主動聯博動能50", "聯博", "tw", None, None),
    EtfEntry("00405A", "主動富邦台灣龍耀", "富邦", "tw", None, None),
    EtfEntry("00406A", "主動中信台灣收益", "中信", "tw", None, None),
    EtfEntry("00407A", "主動凱基台灣", "凱基", "tw", None, None),
    EtfEntry("00980A", "主動野村臺灣優選", "野村", "tw", None, None),
    EtfEntry("00981A", "主動統一台股增長", "統一", "tw", None, None),
    EtfEntry("00982A", "主動群益台灣強棒", "群益", "tw", None, "capital"),
    EtfEntry("00983A", "主動中信ARK創新", "中信", "global", None, None),
    EtfEntry("00984A", "主動安聯台灣高息", "安聯", "tw", None, None),
    EtfEntry("00985A", "主動野村台灣50", "野村", "tw", None, None),
    EtfEntry("00986A", "主動台新龍頭成長", "台新", "tw", None, None),
    EtfEntry("00987A", "主動台新優勢成長", "台新", "tw", None, None),
    EtfEntry("00988A", "主動統一全球創新", "統一", "global", None, None),
    EtfEntry("00989A", "主動摩根美國科技", "摩根", "global", None, None),
    EtfEntry("00990A", "主動元大AI新經濟", "元大", "tw", None, None),  # universe 待確認：名稱未明示市場，首抓時驗證
    EtfEntry("00991A", "主動復華未來50", "復華", "tw", None, None),
    EtfEntry("00992A", "主動群益科技創新", "群益", "tw", "https://www.capitalfund.com.tw/etf/product/detail/500/portfolio", "capital"),
    EtfEntry("00993A", "主動安聯台灣", "安聯", "tw", None, None),
    EtfEntry("00994A", "主動第一金台股優", "第一金", "tw", None, None),
    EtfEntry("00995A", "主動中信台灣卓越", "中信", "tw", None, None),
    EtfEntry("00996A", "主動兆豐台灣豐收", "兆豐", "tw", None, None),
    EtfEntry("00997A", "主動群益美國增長", "群益", "global", None, "capital"),
    EtfEntry("00998A", "主動復華金融股息", "復華", "tw", None, None),
    EtfEntry("00999A", "主動野村臺灣高息", "野村", "tw", None, None),
]


def entries() -> list[EtfEntry]:
    """返回全部 ETF 登錄表。"""
    return REGISTRY


def by_id(etf_id: str) -> EtfEntry:
    """按代號查 ETF——無則 raise StopIteration。"""
    return next(e for e in REGISTRY if e.etf_id == etf_id)
