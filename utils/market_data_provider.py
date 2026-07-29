"""Market-data adapters used by the market-temperature calculator.

The calculator historically consumed a Tushare Pro object directly.  This
module keeps that small interface (trade_cal, daily and index_daily) while
allowing BaoStock to provide the free default and Tushare to remain an
optional fallback.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import Any, Iterable, Optional

import pandas as pd

logger = logging.getLogger(__name__)


class MarketDataSourceError(RuntimeError):
    """Raised when no configured market-data source can satisfy a request."""


def _compact_date(value: str) -> str:
    return str(value).replace("-", "")


def _dashed_date(value: str) -> str:
    compact = _compact_date(value)
    return f"{compact[:4]}-{compact[4:6]}-{compact[6:8]}"


def _to_baostock_code(ts_code: str) -> str:
    code, exchange = str(ts_code).split(".", 1)
    return f"{exchange.lower()}.{code}"


def _to_tushare_code(baostock_code: str) -> str:
    exchange, code = str(baostock_code).split(".", 1)
    return f"{code}.{exchange.upper()}"


def _numeric_columns(frame: pd.DataFrame, columns: Iterable[str]) -> pd.DataFrame:
    for column in columns:
        if column in frame.columns:
            frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame


class BaoStockMarketDataSource:
    """Expose BaoStock through the subset of the Tushare API KHunter needs."""

    name = "baostock"
    _session_lock = threading.RLock()
    _logged_in = False

    def __init__(self) -> None:
        self._bs = None

    def _module(self):
        if self._bs is None:
            try:
                import baostock as bs
            except ImportError as exc:
                raise MarketDataSourceError(
                    "BaoStock 未安装，请同步项目依赖"
                ) from exc
            self._bs = bs
        return self._bs

    def _ensure_login(self) -> None:
        if type(self)._logged_in:
            return

        bs = self._module()
        login_result = bs.login()
        if str(login_result.error_code) != "0":
            raise MarketDataSourceError(
                f"BaoStock 登录失败: {login_result.error_msg}"
            )
        type(self)._logged_in = True

    def _query(self, query_name: str, *args, **kwargs) -> pd.DataFrame:
        with type(self)._session_lock:
            self._ensure_login()
            query = getattr(self._module(), query_name, None)
            if query is None:
                raise MarketDataSourceError(
                    f"当前 BaoStock 版本不支持 {query_name}"
                )

            result = query(*args, **kwargs)
            if str(result.error_code) != "0":
                raise MarketDataSourceError(
                    f"BaoStock {query_name} 失败: {result.error_msg}"
                )

            rows = []
            while result.next():
                rows.append(result.get_row_data())
            return pd.DataFrame(rows, columns=result.fields)

    def trade_cal(
        self,
        start_date: str,
        end_date: str,
        is_open: Optional[str] = None,
        **_: Any,
    ) -> pd.DataFrame:
        frame = self._query(
            "query_trade_dates",
            start_date=_dashed_date(start_date),
            end_date=_dashed_date(end_date),
        )
        frame = frame.rename(
            columns={
                "calendar_date": "cal_date",
                "is_trading_day": "is_open",
            }
        )
        if "cal_date" in frame.columns:
            frame["cal_date"] = frame["cal_date"].map(_compact_date)
        frame = _numeric_columns(frame, ["is_open"])
        if is_open is not None and "is_open" in frame.columns:
            frame = frame[frame["is_open"].astype(str) == str(is_open)]
        return frame.reset_index(drop=True)

    def daily(self, trade_date: str, **_: Any) -> pd.DataFrame:
        frame = self._query(
            "query_daily_history_k_AStock",
            date=_dashed_date(trade_date),
        )
        frame = frame.rename(
            columns={
                "code": "ts_code",
                "date": "trade_date",
                "pctChg": "pct_chg",
            }
        )
        if "ts_code" in frame.columns:
            frame["ts_code"] = frame["ts_code"].map(_to_tushare_code)
        if "trade_date" in frame.columns:
            frame["trade_date"] = frame["trade_date"].map(_compact_date)
        frame = _numeric_columns(
            frame,
            [
                "open",
                "high",
                "low",
                "close",
                "preclose",
                "volume",
                "amount",
                "pct_chg",
            ],
        )
        if (
            "pct_chg" not in frame.columns
            and {"close", "preclose"}.issubset(frame.columns)
        ):
            frame["pct_chg"] = (
                (frame["close"] - frame["preclose"]) / frame["preclose"] * 100
            )
        return frame.reset_index(drop=True)

    def index_daily(
        self,
        ts_code: str,
        trade_date: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        **_: Any,
    ) -> pd.DataFrame:
        if trade_date:
            start_date = end_date = trade_date
        if not start_date or not end_date:
            raise MarketDataSourceError(
                "BaoStock 指数行情查询需要 trade_date 或起止日期"
            )

        frame = self._query(
            "query_history_k_data_plus",
            _to_baostock_code(ts_code),
            "date,code,open,high,low,close,preclose,volume,amount,pctChg",
            start_date=_dashed_date(start_date),
            end_date=_dashed_date(end_date),
            frequency="d",
            adjustflag="3",
        )
        frame = frame.rename(
            columns={
                "code": "ts_code",
                "date": "trade_date",
                "pctChg": "pct_chg",
            }
        )
        if "ts_code" in frame.columns:
            frame["ts_code"] = frame["ts_code"].map(_to_tushare_code)
        if "trade_date" in frame.columns:
            frame["trade_date"] = frame["trade_date"].map(_compact_date)
        frame = _numeric_columns(
            frame,
            [
                "open",
                "high",
                "low",
                "close",
                "preclose",
                "volume",
                "amount",
                "pct_chg",
            ],
        )
        # BaoStock amount is denominated in yuan; Tushare index_daily uses
        # thousand yuan.  Normalize here so the existing calculator remains
        # source-independent.
        if "amount" in frame.columns:
            frame["amount"] = frame["amount"] / 1000
        return frame.reset_index(drop=True)


class HybridMarketDataProvider:
    """Try configured sources in order and normalize failures."""

    def __init__(self, sources: Iterable[Any]) -> None:
        self.sources = list(sources)
        self._cache: dict[tuple[Any, ...], pd.DataFrame] = {}

    @property
    def source_names(self) -> list[str]:
        return [
            getattr(source, "name", source.__class__.__name__)
            for source in self.sources
        ]

    def _call(self, method_name: str, **kwargs) -> pd.DataFrame:
        cache_key = (
            method_name,
            tuple(sorted((key, str(value)) for key, value in kwargs.items())),
        )
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached.copy()

        failures = []
        for source in self.sources:
            source_name = getattr(source, "name", source.__class__.__name__)
            try:
                method = getattr(source, method_name)
                frame = method(**kwargs)
                if frame is not None and not frame.empty:
                    logger.info("市场数据使用 %s.%s", source_name, method_name)
                    self._cache[cache_key] = frame.copy()
                    return frame
                failures.append(f"{source_name}: 返回空数据")
            except Exception as exc:
                logger.warning(
                    "市场数据源 %s.%s 不可用: %s",
                    source_name,
                    method_name,
                    exc,
                )
                failures.append(f"{source_name}: {exc}")

        if not self.sources:
            failures.append("没有已配置的数据源")
        raise MarketDataSourceError(
            f"{method_name} 查询失败；" + "；".join(failures)
        )

    def trade_cal(self, **kwargs) -> pd.DataFrame:
        return self._call("trade_cal", **kwargs)

    def daily(self, **kwargs) -> pd.DataFrame:
        return self._call("daily", **kwargs)

    def index_daily(self, **kwargs) -> pd.DataFrame:
        return self._call("index_daily", **kwargs)


class TushareMarketDataSource:
    """Name a Tushare Pro client for diagnostics while preserving its API."""

    name = "tushare"

    def __init__(self, client: Any) -> None:
        self.client = client

    def trade_cal(self, **kwargs) -> pd.DataFrame:
        return self.client.trade_cal(**kwargs)

    def daily(self, **kwargs) -> pd.DataFrame:
        return self.client.daily(**kwargs)

    def index_daily(self, **kwargs) -> pd.DataFrame:
        return self.client.index_daily(**kwargs)


def _load_tushare_token() -> Optional[str]:
    token = os.getenv("TUSHARE_TOKEN")
    config_path = Path(__file__).parent.parent / "config" / "tushare_config.json"
    if not token and config_path.exists():
        try:
            with config_path.open("r", encoding="utf-8") as config_file:
                config = json.load(config_file)
            token = config.get("token") or config.get("api_key")
        except Exception as exc:
            logger.warning("读取 Tushare 配置失败: %s", exc)
    return token or None


def build_market_data_provider() -> HybridMarketDataProvider:
    """Build the default BaoStock-first, Tushare-fallback provider."""

    available = {
        "baostock": lambda: BaoStockMarketDataSource(),
        "tushare": _build_tushare_source,
    }
    configured_order = os.getenv(
        "MARKET_DATA_SOURCE_ORDER", "baostock,tushare"
    )
    sources = []
    for name in (item.strip().lower() for item in configured_order.split(",")):
        factory = available.get(name)
        if factory is None:
            logger.warning("忽略未知市场数据源: %s", name)
            continue
        source = factory()
        if source is not None:
            sources.append(source)

    return HybridMarketDataProvider(sources)


def _build_tushare_source() -> Optional[TushareMarketDataSource]:
    token = _load_tushare_token()
    if not token:
        logger.info("未配置 Tushare Token，仅使用其他市场数据源")
        return None
    try:
        import tushare as ts

        return TushareMarketDataSource(ts.pro_api(token))
    except Exception as exc:
        logger.warning("初始化 Tushare 失败: %s", exc)
        return None
