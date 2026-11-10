"""Public diagnostic codes shared by archive ingestion and its bounded read model."""
import math


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
