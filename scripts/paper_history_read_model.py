"""Read-only, current-epoch run evidence for the authenticated website."""
from collections import Counter
import datetime as dt
import json
import os
from pathlib import Path
import re
import sqlite3
import uuid

from paper_history_contract import BLOCKERS, ISSUES, RUN_ENUMS, safe_timing

MAX_RUNS = 20000
MAX_MODEL_BYTES = 128 * 1024
CHINA = dt.timezone(dt.timedelta(hours=8))


def timestamp(value):
    if value.tzinfo is None:
        raise ValueError('timezone required')
    return value.astimezone(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def counter_rows(counter):
    return [dict(code=code, count=count) for code, count in sorted(counter.items(), key=lambda item: (-item[1], item[0]))]


def nonnegative_count(value):
    return type(value) is int and 0 <= value <= 1_000_000


def safe_run(value):
    if not isinstance(value, dict):
        raise ValueError('invalid archived run')
    result = {key: value.get(key) if value.get(key) in allowed else None
              for key, allowed in RUN_ENUMS.items() if key in ('session', 'phase', 'regime', 'planQuality', 'sourceStatus')}
    for key in ('submittedOrders', 'skippedOperations'):
        result[key] = value.get(key) if nonnegative_count(value.get(key)) else None
    result['blockers'] = {key: count for key, count in value.get('blockers', {}).items()
                          if key in BLOCKERS and nonnegative_count(count)}
    diagnostics = value.get('researchDiagnostics', {})
    result['issues'] = list(dict.fromkeys(code for code in diagnostics.get('issues', [])
                                         if isinstance(code, str) and code in ISSUES))
    result['timing'] = safe_timing(value.get('timing'))
    return result


def build_read_model(database, account_id, epoch, now=None):
    if not re.fullmatch(r'PAPER-[A-Z0-9-]{1,48}', account_id) or str(uuid.UUID(epoch)) != epoch or uuid.UUID(epoch).version != 4:
        raise ValueError('invalid account identity')
    now = now or dt.datetime.now(dt.timezone.utc)
    generated = timestamp(now)
    end_date = now.astimezone(CHINA).date()
    start_date = end_date - dt.timedelta(days=6)
    start = timestamp(dt.datetime.combine(start_date, dt.time.min, tzinfo=CHINA))
    uri = Path(database).resolve().as_uri() + '?mode=ro'
    conn = sqlite3.connect(uri, uri=True, timeout=5)
    try:
        conn.execute('PRAGMA query_only=ON')
        conn.execute('BEGIN')
        if conn.execute('PRAGMA user_version').fetchone()[0] != 1:
            raise ValueError('unsupported archive schema')
        identity = conn.execute('SELECT first_seen,last_seen FROM account_epochs WHERE account_id=? AND epoch=?', (account_id, epoch)).fetchone()
        if not identity:
            raise ValueError('account not observed')
        rows = conn.execute('SELECT occurred_at,details_json FROM execution_runs WHERE account_id=? AND epoch=? AND occurred_at>=? AND occurred_at<=? ORDER BY occurred_at DESC,audit_id DESC LIMIT ?',
                            (account_id, epoch, start, generated, MAX_RUNS + 1)).fetchall()
        if len(rows) > MAX_RUNS:
            raise ValueError('run evidence exceeds bounded window')
    finally:
        conn.close()
    days = {str(start_date + dt.timedelta(days=index)): dict(date=str(start_date + dt.timedelta(days=index)),
            runs=0, openRuns=0, unknownSessionRuns=0, submittedAttempts=0, submissionEvidenceRuns=0) for index in range(7)}
    blockers, issues, latest = Counter(), Counter(), []
    for occurred_at, body in rows:
        run = safe_run(json.loads(body))
        date = dt.datetime.fromisoformat(occurred_at.replace('Z', '+00:00')).astimezone(CHINA).date()
        day = days[str(date)]
        day['runs'] += 1
        day['openRuns'] += int(run['session'] == 'open')
        day['unknownSessionRuns'] += int(run['session'] is None)
        if run['submittedOrders'] is not None:
            day['submittedAttempts'] += run['submittedOrders']
            day['submissionEvidenceRuns'] += 1
        blockers.update(run['blockers'])
        issues.update(run['issues'])
        if len(latest) < 20:
            latest.append(dict(occurredAt=occurred_at, **run))
    result = dict(schemaVersion=1, accountId=account_id, accountEpoch=epoch,
                  generatedAt=generated, firstObservedAt=identity[0], lastObservedAt=identity[1],
                  window=dict(fromDate=str(start_date), toDate=str(end_date)),
                  runCount=len(rows), openSessionRuns=sum(day['openRuns'] for day in days.values()),
                  unknownSessionRuns=sum(day['unknownSessionRuns'] for day in days.values()),
                  submittedAttempts=sum(day['submittedAttempts'] for day in days.values()),
                  submissionEvidenceRuns=sum(day['submissionEvidenceRuns'] for day in days.values()),
                  days=list(days.values()), blockers=counter_rows(blockers), issues=counter_rows(issues), latestRuns=latest)
    if len(json.dumps(result, ensure_ascii=False, allow_nan=False).encode('utf8')) > MAX_MODEL_BYTES:
        raise ValueError('read model exceeds size limit')
    return result


def publish_read_model(database, account_id, epoch, now=None):
    model = build_read_model(database, account_id, epoch, now)
    directory = Path(database).parent / 'read-model'
    if directory.is_symlink() or directory.exists() and not directory.is_dir():
        raise ValueError('unsafe projection directory')
    directory.mkdir(mode=0o700, exist_ok=True)
    target = directory / 'current.json'
    if target.is_symlink():
        raise ValueError('unsafe projection file')
    temporary = directory / ('current-' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('x', encoding='utf8') as stream:
            os.chmod(temporary, 0o600)
            stream.write(json.dumps(model, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    return target
