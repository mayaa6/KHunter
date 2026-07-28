import pandas as pd
import pytest

from utils.market_temperature import DataNotAvailableError, MarketTemperature


class FakeTusharePro:
    def __init__(self, calendar=None, error=None):
        self.calendar = calendar
        self.error = error

    def trade_cal(self, **kwargs):
        if self.error:
            raise self.error
        return self.calendar


def test_is_trading_day_reads_open_flag():
    open_day = FakeTusharePro(
        pd.DataFrame([{"cal_date": "20260728", "is_open": 1}])
    )
    closed_day = FakeTusharePro(
        pd.DataFrame([{"cal_date": "20260725", "is_open": 0}])
    )

    assert MarketTemperature(open_day).is_trading_day("20260728") is True
    assert MarketTemperature(closed_day).is_trading_day("20260725") is False


def test_missing_tushare_config_is_not_reported_as_non_trading_day():
    calculator = object.__new__(MarketTemperature)
    calculator.tushare_pro = None

    with pytest.raises(DataNotAvailableError, match="Tushare Pro 未配置"):
        calculator.calculate("20260728")


def test_empty_calendar_is_not_reported_as_non_trading_day():
    calculator = MarketTemperature(FakeTusharePro(pd.DataFrame()))

    with pytest.raises(DataNotAvailableError, match="交易日历无日期"):
        calculator.is_trading_day("20260728")


def test_trade_calendar_failure_keeps_original_cause():
    calculator = MarketTemperature(
        FakeTusharePro(error=RuntimeError("token invalid"))
    )

    with pytest.raises(DataNotAvailableError, match="token invalid"):
        calculator.is_trading_day("20260728")


def test_invalid_date_has_clear_error():
    calculator = MarketTemperature(FakeTusharePro(pd.DataFrame()))

    with pytest.raises(DataNotAvailableError, match="日期格式无效"):
        calculator.is_trading_day("2026-07-28")
