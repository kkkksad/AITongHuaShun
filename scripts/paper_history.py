"""Bounded, read-only observer of the Paper JSON ledger (stdlib only).

This database is research evidence, never an execution store or a complete event log.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import uuid
from paper_history_contract import ISSUES, BLOCKERS, RUN_ENUMS, safe_timing, safe_new_position_funnel

MAX_SOURCE_BYTES = 16 * 1024 * 1024
MAX_DATABASE_PAGES = 65536  # 256 MiB at 4096 bytes/page; backups/WAL are additional.
TERMINAL = {"filled", "rejected", "cancelled"}
SCHEMA = """
CREATE TABLE account_epochs (
 account_id TEXT NOT NULL, epoch TEXT NOT NULL, first_seen TEXT NOT NULL,
 last_seen TEXT NOT NULL, starting_equity REAL NOT NULL, PRIMARY KEY(account_id, epoch));
CREATE TABLE account_samples (
 account_id TEXT NOT NULL, epoch TEXT NOT NULL, bucket INTEGER NOT NULL,
 sampled_at TEXT NOT NULL, cash REAL NOT NULL, blocked_cash REAL NOT NULL,
 paused INTEGER NOT NULL, strategy_profile TEXT NOT NULL, execution_strategy TEXT NOT NULL,
 positions_json TEXT NOT NULL, PRIMARY KEY(account_id, epoch, bucket),
 FOREIGN KEY(account_id, epoch) REFERENCES account_epochs(account_id, epoch));
CREATE INDEX samples_time ON account_samples(sampled_at);
CREATE TABLE orders (
 account_id TEXT NOT NULL, epoch TEXT NOT NULL, id TEXT NOT NULL,
 updated_at TEXT NOT NULL, status TEXT NOT NULL, details_json TEXT NOT NULL,
 PRIMARY KEY(account_id, epoch, id),
 FOREIGN KEY(account_id, epoch) REFERENCES account_epochs(account_id, epoch));
CREATE INDEX orders_time ON orders(updated_at);
CREATE TABLE execution_runs (
 account_id TEXT NOT NULL, epoch TEXT NOT NULL, audit_id TEXT NOT NULL,
 occurred_at TEXT NOT NULL, details_json TEXT NOT NULL,
 PRIMARY KEY(account_id, epoch, audit_id),
 FOREIGN KEY(account_id, epoch) REFERENCES account_epochs(account_id, epoch));
CREATE INDEX runs_time ON execution_runs(occurred_at);
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
PRAGMA user_version=1;
"""


def _json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _number(value, nonnegative=False, integer=False):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError("invalid numeric field")
    if (nonnegative and value < 0) or (integer and int(value) != value):
        raise ValueError("invalid numeric range")
    return value


def _code(value, pattern=r"[A-Za-z0-9:_-]{1,128}"):
    if not isinstance(value, str) or not re.fullmatch(pattern, value):
        raise ValueError("invalid code")
    return value


def _time(value):
    if not isinstance(value, str) or len(value) > 40:
        raise ValueError("invalid timestamp")
    stamp = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if stamp.tzinfo is None:
        raise ValueError("timezone is required")
    return stamp.astimezone(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _now(now):
    return _time((now or dt.datetime.now(dt.timezone.utc)).isoformat())


def _position(value):
    result = {"symbol": _code(value["symbol"], r"\d{6}")}
    for key in ("quantity", "averagePrice", "realizedPnl"):
        result[key] = _number(value[key], nonnegative=key != "realizedPnl", integer=key == "quantity")
    return result


def _order(value):
    result = {"id": _code(value["id"]), "symbol": _code(value["symbol"], r"\d{6}")}
    for key, allowed in (("side", {"buy", "sell"}), ("type", {"market", "limit"}),
                         ("status", TERMINAL | {"accepted", "pending"})):
        if value[key] not in allowed:
            raise ValueError("unsupported order field")
        result[key] = value[key]
    for key in ("quantity", "requestedPrice", "filledQuantity", "notional", "commission"):
        result[key] = _number(value[key], nonnegative=True, integer=key in {"quantity", "filledQuantity"})
    for key in ("limitPrice", "filledPrice"):
        if value.get(key) is not None:
            result[key] = _number(value[key], nonnegative=True)
    for key in ("createdAt", "updatedAt"):
        result[key] = _time(value[key])
    if value.get("filledAt"):
        result["filledAt"] = _time(value["filledAt"])
    if value.get("strategyKey"):
        result["strategyKey"] = _code(value["strategyKey"], r"[A-Za-z0-9_-]{1,64}")
    return result


def _run(event):
    data = event["data"]
    result = {}
    coverage = data.get('strategyCoverage')
    if isinstance(coverage, dict) and 'newPositionFunnel' in coverage:
        result['newPositionFunnel'] = safe_new_position_funnel(coverage['newPositionFunnel'])
    if 'timing' in data:
        result['timing'] = safe_timing(data['timing'])
    for key, allowed in RUN_ENUMS.items():
        if isinstance(data.get(key), str) and data[key] in allowed:
            result[key] = data[key]
    for key in ("submittedOrders", "skippedOperations", "candidatePoolSize", "affordableCandidateCount", "matchedCandidateCount"):
        if data.get(key) is not None:
            result[key] = _number(data[key], nonnegative=True, integer=True)
    if type(data.get("allowNewPositions")) is bool:
        result["allowNewPositions"] = data["allowNewPositions"]
    if isinstance(data.get("tradingDate"), str):
        result["tradingDate"] = dt.date.fromisoformat(data["tradingDate"]).isoformat()
    blockers = data.get("blockedReasons")
    if isinstance(blockers, dict):
        result["blockers"] = {}
        for rule, count in blockers.items():
            category = rule.split(":", 1)[0]
            if category in BLOCKERS and rule.startswith(category + ": blocked"):
                result["blockers"][category] = result["blockers"].get(category, 0) + _number(count, True, True)
    plan = data.get("planSnapshot")
    if isinstance(plan, dict):
        result["planSnapshot"] = {key: _number(plan[key], True)
            for key in ("operationCount", "buyPlanCount", "sellPlanCount", "buyNotional", "sellNotional") if key in plan}
    diagnostics = data.get("researchDiagnostics")
    if isinstance(diagnostics, dict):
        result["researchDiagnostics"] = {
            key: _number(diagnostics[key], nonnegative=True, integer=True)
            for key in ("sectorCount", "stockCount", "usableStockCount") if key in diagnostics}
        result["researchDiagnostics"]["issues"] = list(dict.fromkeys(
            code for code in diagnostics.get("issues", [])[:4] if isinstance(code, str) and code in ISSUES))
    return (_code(event["id"]), _time(event["timestamp"]), _json(result))


def _read_source(source):
    # The producer replaces this path atomically. Read one opened inode, not separate stat/read versions.
    with source.open("rb") as file:
        body = file.read(MAX_SOURCE_BYTES + 1)
    if len(body) > MAX_SOURCE_BYTES:
        raise ValueError("source is too large")
    value = json.loads(body)
    if type(value.get("version")) is not int or value["version"] != 1:
        raise ValueError("unsupported source version")
    account = _code(value["accountId"], r"PAPER-[A-Z0-9-]{1,48}")
    epoch = value["accountEpoch"]
    if not isinstance(epoch, str) or str(uuid.UUID(epoch)) != epoch or uuid.UUID(epoch).version != 4:
        raise ValueError("persistent account epoch is required")
    for key in ("positions", "orders", "auditEvents"):
        if not isinstance(value[key], list):
            raise ValueError("invalid collection")
    if type(value["paused"]) is not bool:
        raise ValueError("invalid pause flag")
    # Normalize the entire input before any archive mutation; no raw extra keys survive.
    return dict(account=account, epoch=epoch, starting=_number(value["startingEquity"], True),
                cash=_number(value["cash"]), blocked=_number(value["blockedCash"], True),
                paused=int(value["paused"]), profile=_code(value.get("strategyProfile", "balanced")),
                strategy=_code(value.get("executionStrategy", "auto")),
                positions=_json([_position(item) for item in value["positions"]]),
                orders=[_order(item) for item in value["orders"]],
                runs=[_run(item) for item in value["auditEvents"] if item.get("action") == "paper-auto-execution.run"],
                digest=hashlib.sha256(body).hexdigest())


def _open_readonly(database):
    return sqlite3.connect(Path(database).resolve().as_uri() + "?mode=ro", uri=True, timeout=5)


def _status(conn, verify=False):
    return dict(schemaVersion=conn.execute("PRAGMA user_version").fetchone()[0],
                integrity=conn.execute("PRAGMA quick_check").fetchone()[0] if verify else "not-checked",
                **{key: conn.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]
                   for key, table in (("accountEpochs", "account_epochs"), ("accountSamples", "account_samples"),
                                      ("orders", "orders"), ("executionRuns", "execution_runs"))},
                lastObservedAt=conn.execute("SELECT MAX(last_seen) FROM account_epochs").fetchone()[0],
                databaseBytes=conn.execute("PRAGMA page_count").fetchone()[0] * conn.execute("PRAGMA page_size").fetchone()[0])


def database_status(database):
    conn = _open_readonly(database)
    try:
        result = _status(conn, verify=True)
        if result["integrity"] != "ok":
            raise ValueError("archive integrity failed")
        return result
    finally:
        conn.close()


def archive_once(source, database, now=None):
    source, database = Path(source), Path(database)
    if source.resolve() == database.resolve():
        raise ValueError("source and archive must differ")
    data, timestamp = _read_source(source), _now(now)
    moment = dt.datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    bucket = int(moment.timestamp()) // 300
    database.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(database, timeout=5, isolation_level=None)
    try:
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        if version not in (0, 1) or (version == 0 and conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchone()):
            raise ValueError("unsupported archive schema")
        conn.execute("PRAGMA page_size=4096")
        if conn.execute("PRAGMA page_size").fetchone()[0] != 4096:
            raise ValueError("unsupported archive page size")
        if conn.execute("PRAGMA page_count").fetchone()[0] > MAX_DATABASE_PAGES:
            raise ValueError("archive exceeds capacity")
        conn.execute("PRAGMA max_page_count=" + str(MAX_DATABASE_PAGES))
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=FULL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA cache_size=-4096")
        conn.execute("PRAGMA journal_size_limit=16777216")
        if version == 0:
            conn.executescript("BEGIN IMMEDIATE;" + SCHEMA + "COMMIT;")
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("INSERT INTO account_epochs VALUES (?,?,?,?,?) ON CONFLICT(account_id,epoch) DO UPDATE SET last_seen=MAX(last_seen,excluded.last_seen)",
                     (data["account"], data["epoch"], timestamp, timestamp, data["starting"]))
        conn.execute("INSERT INTO account_samples VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,epoch,bucket) DO UPDATE SET sampled_at=excluded.sampled_at,cash=excluded.cash,blocked_cash=excluded.blocked_cash,paused=excluded.paused,strategy_profile=excluded.strategy_profile,execution_strategy=excluded.execution_strategy,positions_json=excluded.positions_json",
                     (data["account"], data["epoch"], bucket, timestamp, data["cash"], data["blocked"], data["paused"], data["profile"], data["strategy"], data["positions"]))
        conn.executemany("INSERT INTO orders VALUES (?,?,?,?,?,?) ON CONFLICT(account_id,epoch,id) DO UPDATE SET updated_at=excluded.updated_at,status=excluded.status,details_json=excluded.details_json WHERE excluded.updated_at>=orders.updated_at AND (orders.status IN ('pending','accepted') OR orders.status=excluded.status)",
                         [(data["account"], data["epoch"], item["id"], item["updatedAt"], item["status"], _json(item)) for item in data["orders"]])
        conn.executemany("INSERT OR IGNORE INTO execution_runs VALUES (?,?,?,?,?)",
                         [(data["account"], data["epoch"], *item) for item in data["runs"]])
        cutoff = lambda days: _now(moment - dt.timedelta(days=days))
        conn.execute("DELETE FROM account_samples WHERE sampled_at < ?", (cutoff(90),))
        conn.execute("DELETE FROM execution_runs WHERE occurred_at < ?", (cutoff(90),))
        conn.execute("DELETE FROM orders WHERE status IN ('filled','cancelled','rejected') AND updated_at < ?", (cutoff(365),))
        conn.execute("DELETE FROM account_epochs WHERE last_seen < ? AND NOT EXISTS (SELECT 1 FROM account_samples s WHERE s.account_id=account_epochs.account_id AND s.epoch=account_epochs.epoch) AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.account_id=account_epochs.account_id AND o.epoch=account_epochs.epoch) AND NOT EXISTS (SELECT 1 FROM execution_runs r WHERE r.account_id=account_epochs.account_id AND r.epoch=account_epochs.epoch)", (cutoff(365),))
        conn.execute("INSERT OR REPLACE INTO metadata VALUES ('source_sha256',?)", (data["digest"],))
        conn.commit()
        return _status(conn)
    except BaseException:
        if conn.in_transaction:
            conn.rollback()
        raise
    finally:
        conn.close()


def backup_database(database, now=None, force=False):
    database = Path(database)
    date = dt.datetime.fromisoformat(_now(now).replace("Z", "+00:00")).astimezone(dt.timezone(dt.timedelta(hours=8))).date()
    backups = database.parent / "backups"
    backups.mkdir(exist_ok=True)
    target = backups / ("paper-history-" + str(date) + ".sqlite")
    if force or not target.exists():
        temporary = target.with_suffix(".sqlite.tmp")
        source_conn = _open_readonly(database)
        destination = None
        try:
            if temporary.exists():
                temporary.unlink()
            destination = sqlite3.connect(temporary)
            source_conn.backup(destination, pages=128, sleep=0.01)
            if destination.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise ValueError("backup integrity failed")
            destination.close()
            destination = None
            temporary.replace(target)
        finally:
            source_conn.close()
            if destination is not None:
                destination.close()
            if temporary.exists():
                temporary.unlink()
    owned = sorted(file for file in backups.glob("paper-history-????-??-??.sqlite")
                   if re.fullmatch(r"paper-history-\d{4}-\d{2}-\d{2}\.sqlite", file.name) and file.is_file() and not file.is_symlink())
    for old in owned[:-3]:
        old.unlink()
    return target


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("runtime/data/paper-trading-state.json"))
    parser.add_argument("--database", type=Path, default=Path("runtime/archive/paper-history.sqlite"))
    parser.add_argument("--status", action="store_true", help="read-only counts and integrity check")
    parser.add_argument("--backup", action="store_true", help="force refresh today's online backup after sampling")
    args = parser.parse_args()
    try:
        if args.status:
            print(_json(database_status(args.database)))
            return 0
        result = archive_once(args.source, args.database)
        backup_database(args.database, force=args.backup)
        try:
            from paper_history_read_model import publish_read_model
            identity = _read_source(args.source)
            publish_read_model(args.database, identity["account"], identity["epoch"])
            result["readModelStatus"] = "published"
        except (OSError, ValueError, KeyError, TypeError, AttributeError, OverflowError, sqlite3.Error):
            # The database commit is already durable. Keep its success independent
            # of the website projection; an old projection ages into stale state.
            result["readModelStatus"] = "unavailable"
        result["lastSuccessAt"] = _now(None)
        temporary = args.database.parent / "status.json.tmp"
        temporary.write_text(_json(result) + "\n", encoding="utf8")
        temporary.replace(args.database.parent / "status.json")
        print(_json(result))
        return 0
    except (OSError, ValueError, KeyError, TypeError, AttributeError, OverflowError, sqlite3.Error) as error:
        # Never log source bodies, credentials, SQL values or arbitrary provider error text.
        print(_json({"ok": False, "error": type(error).__name__}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
