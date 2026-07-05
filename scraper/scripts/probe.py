"""打一遍全部投信 PCF 頁，回報 HTTP 狀態與內容長度——判斷海外 IP 封鎖（spec §5 風險）。
用法：uv run python scripts/probe.py   （在本機與 GitHub Actions 各跑一次比對）"""
import time
import requests
from activeetf.registry import entries

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

for e in entries():
    if not e.pcf_url:
        print(f"{e.etf_id}  SKIP (no url yet)")
        continue
    try:
        r = requests.get(e.pcf_url, headers=UA, timeout=30)
        print(f"{e.etf_id}  {r.status_code}  {len(r.content):>8} bytes  {e.pcf_url}")
    except Exception as ex:
        print(f"{e.etf_id}  ERROR {type(ex).__name__}: {ex}")
    time.sleep(1.5)   # 禮貌間隔
