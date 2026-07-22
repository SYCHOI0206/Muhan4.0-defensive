#!/usr/bin/env python3
"""Synchronize SOXL daily closes from Yahoo Finance into GitHub Pages JSON.

The browser reads same-origin JSON files. GitHub Actions performs the Yahoo
request server-side, avoiding browser CORS failures. Yahoo's chart endpoint is
undocumented, so query1 and query2 are both tried and existing data is kept if
all providers fail.
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
LATEST_OUTPUT = ROOT / 'data' / 'latest-close.json'
HISTORY_OUTPUT = ROOT / 'data' / 'close-history.json'
TICKER = os.environ.get('TICKER', 'SOXL').strip().upper() or 'SOXL'
FULL_REFRESH = os.environ.get('FULL_REFRESH', '').strip().lower() in {'1','true','yes','on'}
USER_AGENT = 'Mozilla/5.0 (compatible; SOXL-V4-Yahoo-Sync/3.0; +https://github.com/)'
NY = ZoneInfo('America/New_York')


def request_json(url: str, attempts: int = 4, timeout: int = 30) -> dict[str, Any]:
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            req = Request(url, headers={
                'User-Agent': USER_AGENT,
                'Accept': 'application/json,text/plain,*/*',
                'Cache-Control': 'no-cache',
            })
            with urlopen(req, timeout=timeout) as response:
                return json.loads(response.read().decode('utf-8'))
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = exc
            if attempt + 1 < attempts:
                time.sleep(2 ** attempt)
    raise RuntimeError(f'Yahoo request failed: {last}')


def read_history() -> dict[str, Any]:
    if HISTORY_OUTPUT.exists():
        try:
            data = json.loads(HISTORY_OUTPUT.read_text(encoding='utf-8'))
            if isinstance(data, dict) and isinstance(data.get('quotes'), dict):
                return data
        except (OSError, json.JSONDecodeError):
            pass
    return {'ticker': TICKER, 'quotes': {}}


def start_timestamp(existing: dict[str, Any]) -> int:
    quotes = existing.get('quotes') if isinstance(existing, dict) else None
    if FULL_REFRESH or not isinstance(quotes, dict) or not quotes:
        # SOXL inception is 2010, but 2009 leaves a safe margin.
        start = datetime(2009, 1, 1, tzinfo=timezone.utc)
    else:
        last = max(str(x) for x in quotes)
        start_day = date.fromisoformat(last) - timedelta(days=45)
        start = datetime(start_day.year, start_day.month, start_day.day, tzinfo=timezone.utc)
    return int(start.timestamp())


def yahoo_url(host: str, period1: int, period2: int) -> str:
    params = urlencode({
        'period1': period1,
        'period2': period2,
        'interval': '1d',
        'includePrePost': 'false',
        'events': 'div,splits',
    })
    return f'https://{host}/v8/finance/chart/{quote(TICKER)}?{params}'


def fetch_chart(period1: int, period2: int) -> tuple[dict[str, Any], str]:
    errors: list[str] = []
    for host in ('query1.finance.yahoo.com', 'query2.finance.yahoo.com'):
        try:
            data = request_json(yahoo_url(host, period1, period2))
            error = (data.get('chart') or {}).get('error')
            result = (data.get('chart') or {}).get('result') or []
            if error:
                raise RuntimeError(str(error))
            if not result:
                raise RuntimeError('empty chart result')
            return result[0], host
        except Exception as exc:
            errors.append(f'{host}: {exc}')
    raise RuntimeError(' | '.join(errors))


def completed_today(meta: dict[str, Any], now_utc: datetime) -> bool:
    # Do not save a partial daily candle as a final close. Ten minutes after the
    # regular-session end is used as a safety buffer; the workflow retries later.
    period = ((meta.get('currentTradingPeriod') or {}).get('regular') or {})
    end = period.get('end')
    if end is not None:
        try:
            return now_utc.timestamp() >= float(end) + 600
        except (TypeError, ValueError):
            pass
    now_ny = now_utc.astimezone(NY)
    return (now_ny.hour, now_ny.minute) >= (16, 10)


def rows_from_chart(result: dict[str, Any], now_utc: datetime) -> list[dict[str, Any]]:
    meta = result.get('meta') or {}
    tz_name = meta.get('exchangeTimezoneName') or 'America/New_York'
    try:
        exchange_tz = ZoneInfo(str(tz_name))
    except Exception:
        exchange_tz = NY
    timestamps = result.get('timestamp') or []
    quote_data = (((result.get('indicators') or {}).get('quote') or [{}])[0])
    opens = quote_data.get('open') or []
    highs = quote_data.get('high') or []
    lows = quote_data.get('low') or []
    closes = quote_data.get('close') or []
    volumes = quote_data.get('volume') or []
    today_ny = now_utc.astimezone(exchange_tz).date()
    today_is_complete = completed_today(meta, now_utc)

    def value(arr: list[Any], index: int) -> Any:
        return arr[index] if index < len(arr) else None

    rows: list[dict[str, Any]] = []
    for i, raw_ts in enumerate(timestamps):
        close = value(closes, i)
        if close is None:
            continue
        try:
            close_f = float(close)
        except (TypeError, ValueError):
            continue
        if close_f <= 0:
            continue
        session_date = datetime.fromtimestamp(int(raw_ts), exchange_tz).date()
        if session_date > today_ny:
            continue
        if session_date == today_ny and not today_is_complete:
            continue
        rows.append({
            'date': session_date.isoformat(),
            'open': value(opens, i),
            'high': value(highs, i),
            'low': value(lows, i),
            'close': close_f,
            'volume': value(volumes, i),
        })
    return rows


def write_json_atomic(path: Path, payload: dict[str, Any], compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    if compact:
        text = json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n'
    else:
        text = json.dumps(payload, ensure_ascii=False, indent=2) + '\n'
    tmp.write_text(text, encoding='utf-8')
    tmp.replace(path)


def synchronize(now_utc: datetime | None = None) -> dict[str, Any]:
    now_utc = now_utc or datetime.now(timezone.utc)
    existing = read_history()
    period1 = start_timestamp(existing)
    period2 = int((now_utc + timedelta(days=2)).timestamp())
    result, host = fetch_chart(period1, period2)
    rows = rows_from_chart(result, now_utc)
    if not rows:
        raise RuntimeError('Yahoo returned no completed daily bars')

    old_quotes = existing.get('quotes') if isinstance(existing.get('quotes'), dict) else {}
    quotes: dict[str, float] = {
        str(k): float(v) for k, v in old_quotes.items()
        if isinstance(k, str) and isinstance(v, (int, float)) and float(v) > 0
    }
    for row in rows:
        quotes[row['date']] = float(row['close'])
    ordered = dict(sorted(quotes.items()))
    updated_at = now_utc.isoformat(timespec='seconds').replace('+00:00', 'Z')
    meta = result.get('meta') or {}
    source = f'Yahoo Finance chart endpoint ({host})'
    history_payload = {
        'ticker': TICKER,
        'schema_version': 3,
        'first_date': next(iter(ordered)),
        'last_date': next(reversed(ordered)),
        'count': len(ordered),
        'updated_at': updated_at,
        'source': source,
        'exchange': meta.get('exchangeName'),
        'timezone': meta.get('exchangeTimezoneName'),
        'quotes': ordered,
    }
    write_json_atomic(HISTORY_OUTPUT, history_payload, compact=True)

    latest_date = history_payload['last_date']
    latest_row = next((row for row in reversed(rows) if row['date'] == latest_date), None)
    if latest_row is None:
        latest_row = {'date': latest_date, 'close': ordered[latest_date], 'open': None, 'high': None, 'low': None, 'volume': None}
    latest_payload = {
        'ticker': TICKER,
        'date': latest_date,
        'open': latest_row.get('open'),
        'high': latest_row.get('high'),
        'low': latest_row.get('low'),
        'close': float(ordered[latest_date]),
        'volume': latest_row.get('volume'),
        'source': source,
        'updated_at': updated_at,
        'schema_version': 3,
        'market_state': meta.get('marketState'),
        'regular_market_price': meta.get('regularMarketPrice'),
        'regular_market_time': meta.get('regularMarketTime'),
    }
    write_json_atomic(LATEST_OUTPUT, latest_payload)
    return {'latest': latest_payload, 'history_count': len(ordered), 'full_refresh': FULL_REFRESH}


def main() -> int:
    print(json.dumps(synchronize(), ensure_ascii=False))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        raise
