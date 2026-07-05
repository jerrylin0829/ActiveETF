"""Adapter 統一介面：fetch(entry) -> list[Holding]。
每家投信一個模組，模組內只管「怎麼把該家格式轉成 Holding」；
重試、驗證、入庫都在 pipeline，adapter 保持純粹。"""
import importlib
from typing import Protocol
from activeetf.models import Holding
from activeetf.registry import EtfEntry

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

class Adapter(Protocol):
    def fetch(self, entry: EtfEntry) -> list[Holding]: ...

def load(name: str) -> Adapter:
    return importlib.import_module(f"activeetf.adapters.{name}")
