"""Public diagnostic codes shared by archive ingestion and its bounded read model."""
import math
import datetime as dt
import re


def safe_stock_history_coverage(value, occurred_at, stock_count, usable_stock_count):
    """Optional identity evidence cannot invalidate the original run or add authority."""
    if not isinstance(value, dict) or value.get('scope') != 'regime-stock-history':
        return None
    as_of = value.get('asOf')
    pattern = r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z'
    if not isinstance(as_of, str) or not re.fullmatch(pattern, as_of):
        return None
    if not isinstance(occurred_at, str) or not re.fullmatch(pattern, occurred_at):
        return None
    try:
        cutoff = dt.datetime.fromisoformat(as_of.replace('Z', '+00:00'))
        occurred = dt.datetime.fromisoformat(occurred_at.replace('Z', '+00:00'))
    except ValueError:
        return None
    if cutoff > occurred:
        return None
    result = dict(scope='regime-stock-history', asOf=as_of)
    previous = None
    for key in ('selectedSymbols', 'returnedSymbols', 'acceptedSymbols', 'usableSymbols'):
        sample = value.get(key)
        if (not isinstance(sample, list) or len(sample) > 12
                or any(not isinstance(symbol, str) or not re.fullmatch(r'[0-9]{6}', symbol) for symbol in sample)
                or len(set(sample)) != len(sample)):
            return None
        if previous is not None and [symbol for symbol in previous if symbol in sample] != sample:
            return None
        result[key] = list(sample)
        previous = sample
    if (type(stock_count) is not int or type(usable_stock_count) is not int
            or len(result['acceptedSymbols']) != stock_count or len(result['usableSymbols']) != usable_stock_count):
        return None
    return result


def safe_new_position_funnel(value):
    """Only bounded count evidence; no symbols, order authority, or inferred history."""
    if not isinstance(value, dict) or value.get('scope') != 'ranked-top-12' or type(value.get('allowNewPositions')) is not bool:
        return None
    result = dict(scope='ranked-top-12', allowNewPositions=value['allowNewPositions'])
    for key in ('scannerCandidateCount', 'consideredCandidateCount', 'existingPositionCount', 'newSymbolCount',
                'eligibleNewSymbolCount', 'individuallySizedNewSymbolCount', 'plannedBuyCount'):
        sample = value.get(key)
        if type(sample) is not int or sample < 0 or sample > (1_000_000 if key == 'scannerCandidateCount' else 12):
            return None
        result[key] = sample
    if (result['existingPositionCount'] + result['newSymbolCount'] != result['consideredCandidateCount']
            or result['consideredCandidateCount'] > result['scannerCandidateCount']
            or result['eligibleNewSymbolCount'] > result['newSymbolCount']
            or result['individuallySizedNewSymbolCount'] > result['eligibleNewSymbolCount']
            or result['plannedBuyCount'] > result['newSymbolCount']):
        return None
    return result


def safe_timing(value):
    """Optional diagnostics cannot invalidate otherwise valid account evidence."""
    if not isinstance(value, dict) or any(value.get(key) != expected for key, expected in (
            ('clock', 'monotonic'), ('scope', 'run-before-audit'), ('unit', 'ms'))):
        return None
    result = dict(clock='monotonic', scope='run-before-audit', unit='ms')
    for key in ('totalMs', 'researchMs', 'notificationMs', 'executionMs'):
        if key not in value:
            return None
        sample = value[key]
        if sample is not None and (type(sample) not in (int, float) or sample < 0
                                   or sample > 86_400_000 or not math.isfinite(sample)):
            return None
        result[key] = sample
    if result['totalMs'] is not None and sum(result[key] or 0 for key in (
            'researchMs', 'notificationMs', 'executionMs')) > result['totalMs'] + 0.003:
        return None
    return result


ISSUES = {"provider-contract", "provider-timeout", "history-warming", "history-queue-full",
          "sector-history-insufficient", "stock-history-insufficient", "provider-warning"}
BLOCKERS = {"T+1", "strategy-profile", "adaptive-new-position", "strategy-route", "lot-size",
            "cash-check", "cash-reservation", "plan-sizing", "defensive-score",
            "same-day-reentry", "round-trip-fee-ratio", "entry-persistence"}
RUN_ENUMS = {
    "trigger": {"timer", "manual", "startup"},
    "session": {"open", "pre-market", "lunch-break", "after-hours", "weekend", "holiday", "calendar-unavailable"},
    "sourceStatus": {"live-read-only", "degraded", "mock-disabled"},
    "planQuality": {"actionable", "watch-only", "blocked", "not-run"},
    "activityMode": {"observe", "qualified-probe", "validation-probe"},
    "phase": {"opening", "morning-confirmation", "afternoon-confirmation", "closing-risk-review", "closed"},
    "regime": {"trend-up-low-volatility", "trend-up-high-volatility", "range-low-volatility",
               "range-high-volatility", "risk-off-recovery", "risk-off", "unclear"},
}
