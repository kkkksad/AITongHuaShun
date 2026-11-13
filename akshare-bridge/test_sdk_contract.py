"""Offline contract check against the pinned, real SDK (isolated from mock tests)."""

from pathlib import Path
import subprocess
import sys

import pytest


def test_real_sdk_stock_history_transport_is_bounded_and_forward_adjusted():
    version = subprocess.run(
        [sys.executable, "-c", "import akshare; print(akshare.__version__)"],
        capture_output=True, text=True, timeout=30,
    )
    if version.returncode != 0 or version.stdout.strip() != "1.20.34":
        pytest.skip("Install requirements.txt to run the pinned SDK contract check")

    script = r'''
import json
from unittest.mock import Mock, patch
import akshare as ak
import main

assert ak.get_timeout() == main.HISTORY_PROVIDER_TIMEOUT_SEC
seen = []
empty_primary = False
def transport(method, url, **kwargs):
    assert kwargs["timeout"] == main.HISTORY_PROVIDER_TIMEOUT_SEC
    assert method == "get"
    seen.append((url, kwargs["params"]))
    response = Mock()
    response.status_code = 200
    if "eastmoney.com" in url:
        assert kwargs["params"]["fqt"] == "1"
        response.json.return_value = {"data": None} if empty_primary else {"data": {"klines": [
            "2026-11-06,10,11,12,9,100,110000,30,10,1,2",
        ]}}
    else:
        assert kwargs["params"]["param"].endswith(",qfq")
        response.text = json.dumps({"data": {"sh600036": {"qfqday": [
            ["2026-11-06", "10", "11", "12", "9", "100", "", "2", "3"],
        ]}}})
    return response

with patch("requests.request", side_effect=transport):
    frame, source = main.fetch_stock_history_dataframe("600036", "20260101", "20261109")
    assert source == "eastmoney-stock-history"
    series = main.normalize_history_dataframe(frame, "600036", "test", source, "qfq", 180)
    assert len(series.bars) == 1 and series.bars[0].close == 11
    assert frame.iloc[0]["成交量"] == 100
    assert series.bars[0].volume == 10000 and series.bars[0].amount == 110000
    assert series.adjustment == "qfq"
    with patch("main.ak.stock_zh_a_hist", side_effect=RuntimeError("offline")):
        # The metadata helper performs an unrelated request; isolate only it.
        with patch.dict(ak.stock_zh_a_hist_tx.__globals__, {"get_tx_start_year": lambda symbol: "20250101"}):
            frame, source = main.fetch_stock_history_dataframe("600036", "20260101", "20261109")
    assert source == "tencent-stock-history"
    series = main.normalize_history_dataframe(frame, "600036", "test", source, "qfq", 180)
    assert len(series.bars) == 1 and series.bars[0].close == 11
    assert frame.iloc[0]["volume"] == 10000
    assert series.bars[0].volume == 10000
    assert series.adjustment == "qfq"
assert len(seen) == 2
empty_primary = True
with patch("requests.request", side_effect=transport):
    with patch.dict(ak.stock_zh_a_hist_tx.__globals__, {"get_tx_start_year": lambda symbol: "20250101"}):
        frame, source = main.fetch_stock_history_dataframe("600036", "20260101", "20261109")
assert source == "tencent-stock-history"
assert len(frame) == 1
series = main.normalize_history_dataframe(frame, "600036", "test", source, "qfq", 180)
assert series.bars[0].volume == 10000
assert len(seen) == 4
assert "eastmoney.com" in seen[2][0] and "qq.com" in seen[3][0]
print("real SDK contracts and network timeouts verified")
'''
    result = subprocess.run(
        [sys.executable, "-c", script], cwd=Path(__file__).parent,
        capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
