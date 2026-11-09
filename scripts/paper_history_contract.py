"""Public diagnostic codes shared by archive ingestion and its bounded read model."""
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
