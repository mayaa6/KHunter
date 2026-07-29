from types import SimpleNamespace

import pandas as pd
import pytest

from utils.market_data_provider import (
    BaoStockMarketDataSource,
    HybridMarketDataProvider,
    MarketDataSourceError,
)


class FakeResult:
    def __init__(self, fields, rows=None, error_code="0", error_msg="success"):
        self.fields = fields
        self.rows = rows or []
        self.error_code = error_code
        self.error_msg = error_msg
        self.index = 0

    def next(self):
        return self.index < len(self.rows)

    def get_row_data(self):
        row = self.rows[self.index]
        self.index += 1
        return row


class FakeBaoStock:
    def __init__(self):
        self.login_count = 0

    def login(self):
        self.login_count += 1
        return SimpleNamespace(error_code="0", error_msg="success")

    def query_trade_dates(self, start_date, end_date):
        assert start_date == "2026-07-25"
        assert end_date == "2026-07-28"
        return FakeResult(
            ["calendar_date", "is_trading_day"],
            [["2026-07-25", "0"], ["2026-07-28", "1"]],
        )

    def query_daily_history_k_AStock(self, date):
        assert date == "2026-07-28"
        return FakeResult(
            ["date", "code", "close", "preclose", "pctChg", "amount"],
            [["2026-07-28", "sh.600000", "10.5", "10", "5", "1000"]],
        )

    def query_history_k_data_plus(
        self,
        code,
        fields,
        start_date,
        end_date,
        frequency,
        adjustflag,
    ):
        assert code == "sh.000001"
        assert start_date == "2026-07-28"
        assert end_date == "2026-07-28"
        assert frequency == "d"
        assert adjustflag == "3"
        return FakeResult(
            fields.split(","),
            [
                [
                    "2026-07-28",
                    "sh.000001",
                    "3500",
                    "3520",
                    "3480",
                    "3510",
                    "3490",
                    "100",
                    "123450000000",
                    "0.57",
                ]
            ],
        )


@pytest.fixture
def baostock_source():
    fake = FakeBaoStock()
    source = BaoStockMarketDataSource()
    source._bs = fake
    BaoStockMarketDataSource._logged_in = False
    yield source, fake
    BaoStockMarketDataSource._logged_in = False


def test_baostock_trade_calendar_is_normalized(baostock_source):
    source, fake = baostock_source

    result = source.trade_cal(start_date="20260725", end_date="20260728")

    assert result.to_dict("records") == [
        {"cal_date": "20260725", "is_open": 0},
        {"cal_date": "20260728", "is_open": 1},
    ]
    assert fake.login_count == 1


def test_baostock_daily_market_data_is_normalized(baostock_source):
    source, _ = baostock_source

    result = source.daily(trade_date="20260728")

    assert result.iloc[0]["ts_code"] == "600000.SH"
    assert result.iloc[0]["trade_date"] == "20260728"
    assert result.iloc[0]["pct_chg"] == 5


def test_baostock_index_amount_matches_tushare_unit(baostock_source):
    source, _ = baostock_source

    result = source.index_daily(
        ts_code="000001.SH",
        trade_date="20260728",
    )

    assert result.iloc[0]["ts_code"] == "000001.SH"
    assert result.iloc[0]["trade_date"] == "20260728"
    assert result.iloc[0]["amount"] == 123450000


def test_hybrid_provider_falls_back_and_caches():
    class BrokenSource:
        name = "broken"

        def daily(self, **kwargs):
            raise RuntimeError("offline")

    class WorkingSource:
        name = "working"

        def __init__(self):
            self.calls = 0

        def daily(self, **kwargs):
            self.calls += 1
            return pd.DataFrame([{"ts_code": "600000.SH", "pct_chg": 1.2}])

    working = WorkingSource()
    provider = HybridMarketDataProvider([BrokenSource(), working])

    first = provider.daily(trade_date="20260728")
    second = provider.daily(trade_date="20260728")

    assert first.equals(second)
    assert working.calls == 1


def test_hybrid_provider_reports_all_failures():
    class EmptySource:
        name = "empty"

        def trade_cal(self, **kwargs):
            return pd.DataFrame()

    provider = HybridMarketDataProvider([EmptySource()])

    with pytest.raises(MarketDataSourceError, match="empty: 返回空数据"):
        provider.trade_cal(start_date="20260728", end_date="20260728")
