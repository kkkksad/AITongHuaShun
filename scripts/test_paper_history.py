"""Offline archive contracts; Python stdlib only, no production writes."""
import copy
from contextlib import closing
import datetime as dt
import json
import pathlib
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from paper_history import archive_once, backup_database, database_status, MAX_SOURCE_BYTES

NOW = dt.datetime(2026, 11, 9, 15, 0, tzinfo=dt.timezone.utc)
EPOCH = "034f4f49-c160-43f8-9c8d-f319e35d215d"
OTHER_EPOCH = "2e64ed4f-b965-4504-9418-a4276eb03df0"


def order(status="pending"):
    return dict(id="PO-1", symbol="000001", side="buy", type="limit", quantity=100,
                status=status, requestedPrice=10, filledQuantity=0, notional=0,
                commission=0, createdAt="2026-11-09T14:00:00.000Z",
                updatedAt="2026-11-09T14:00:00.000Z", apiKey="DO_NOT_ARCHIVE")


def state():
    return dict(version=1, accountId="PAPER-CN-01", accountEpoch=EPOCH,
                startingEquity=20000, cash=20000, blockedCash=1000, paused=False,
                strategyProfile="growth", executionStrategy="auto", positions=[],
                orders=[order()], auditEvents=[dict(id="AE-1", action="paper-auto-execution.run",
                timestamp="2026-11-09T14:30:00.000Z", data=dict(trigger="scheduler",
                tradingDate="2026-11-09", submittedOrders=0, skippedOperations=3,
                candidatePoolSize=12, researchDiagnostics=dict(stockHistoryCount=5),
                token="DO_NOT_ARCHIVE", rawResponse="DO_NOT_ARCHIVE"))],
                orderSequence=1, auditSequence=1, cookie="DO_NOT_ARCHIVE")


class PaperHistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.source = self.root / "paper-trading-state.json"
        self.database = self.root / "archive" / "paper-history.sqlite"
        self.input = state()
        self.write()

    def write(self):
        self.source.write_text(json.dumps(self.input), encoding="utf8")

    def archive(self, now=NOW):
        return archive_once(self.source, self.database, now=now)

    def query(self, sql, args=()):
        with closing(sqlite3.connect(self.database)) as conn:
            return conn.execute(sql, args).fetchall()

    def test_copies_real_values_without_double_subtracting_reserved_cash_or_secrets(self):
        before = self.source.read_bytes()
        result = self.archive()
        self.assertEqual(result["orders"], 1)
        self.assertEqual(self.query("SELECT cash, blocked_cash FROM account_samples"), [(20000, 1000)])
        self.assertEqual(self.source.read_bytes(), before)
        with closing(sqlite3.connect(self.database)) as conn:
            dump = "\n".join(conn.iterdump())
        self.assertNotIn("DO_NOT_ARCHIVE", dump)
        self.assertEqual(self.query("SELECT COUNT(*) FROM execution_runs"), [(1,)])

    def test_repeated_poll_and_restarted_observer_are_idempotent(self):
        self.archive()
        self.archive(NOW + dt.timedelta(minutes=1))
        self.assertEqual(self.query("SELECT COUNT(*) FROM orders"), [(1,)])
        self.assertEqual(self.query("SELECT COUNT(*) FROM execution_runs"), [(1,)])
        self.assertEqual(self.query("SELECT COUNT(*) FROM account_samples"), [(1,)])
        self.archive(NOW + dt.timedelta(minutes=5))
        self.assertEqual(self.query("SELECT COUNT(*) FROM account_samples"), [(2,)])

    def test_pending_to_filled_updates_one_order_and_preserves_fee(self):
        self.archive()
        self.input["orders"][0].update(status="filled", filledPrice=10.01,
            filledQuantity=100, notional=1001, commission=5, filledAt="2026-11-09T14:01:00Z",
            updatedAt="2026-11-09T14:01:00Z")
        self.write()
        self.archive()
        rows = self.query("SELECT status, details_json FROM orders")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][0], "filled")
        self.assertEqual(json.loads(rows[0][1])["commission"], 5)
        self.assertEqual(json.loads(rows[0][1])["filledPrice"], 10.01)

    def test_two_identical_account_resets_do_not_merge_orders(self):
        self.archive()
        self.input["accountEpoch"] = OTHER_EPOCH
        self.write()
        self.archive()
        self.assertEqual(self.query("SELECT COUNT(*) FROM account_epochs"), [(2,)])
        self.assertEqual(self.query("SELECT COUNT(*) FROM orders"), [(2,)])

    def test_missing_recent_source_records_do_not_delete_long_term_orders(self):
        self.archive()
        self.input["orders"] = []
        self.input["auditEvents"] = []
        self.write()
        self.archive()
        self.assertEqual(self.query("SELECT COUNT(*) FROM orders"), [(1,)])
        self.assertEqual(self.query("SELECT COUNT(*) FROM execution_runs"), [(1,)])

    def test_retention_preserves_pending_orders_and_removes_old_terminal_evidence(self):
        self.input["orders"] += [dict(order("filled"), id="PO-old", updatedAt="2025-01-01T00:00:00Z")]
        self.write()
        self.archive()
        self.assertEqual(self.query("SELECT id FROM orders"), [("PO-1",)])
        self.archive(NOW + dt.timedelta(days=100))
        self.assertEqual(self.query("SELECT COUNT(*) FROM account_samples"), [(1,)])
        self.assertEqual(self.query("SELECT COUNT(*) FROM execution_runs"), [(0,)])
        self.assertEqual(self.query("SELECT COUNT(*) FROM orders"), [(1,)])

    def test_bad_record_rejects_whole_input_without_partially_updating_archive(self):
        self.archive()
        self.input["orders"][0]["commission"] = 9
        self.input["orders"].append(dict(order(), id="PO-bad", quantity=float("nan")))
        self.write()
        with self.assertRaises(ValueError):
            self.archive()
        self.assertEqual(json.loads(self.query("SELECT details_json FROM orders")[0][0])["commission"], 0)

    def test_missing_epoch_unknown_version_and_partial_json_fail_without_creating_database(self):
        for change in ({"accountEpoch": ""}, {"version": 2}):
            self.input = dict(state(), **change)
            self.write()
            with self.assertRaises(ValueError):
                self.archive()
            self.assertFalse(self.database.exists())
        self.source.write_text('{"version":', encoding="utf8")
        with self.assertRaises(ValueError):
            self.archive()
        self.assertFalse(self.database.exists())

    def test_oversize_source_is_rejected_before_parse_or_database_write(self):
        with self.source.open("wb") as file:
            file.seek(MAX_SOURCE_BYTES)
            file.write(b" ")
        with self.assertRaises(ValueError):
            self.archive()
        self.assertFalse(self.database.exists())

    def test_unknown_database_version_is_preserved_and_not_reinitialized(self):
        self.database.parent.mkdir()
        with closing(sqlite3.connect(self.database)) as conn, conn:
            conn.execute("PRAGMA user_version=99")
            conn.execute("CREATE TABLE keep(value)")
            conn.execute("INSERT INTO keep VALUES ('preserved')")
        with self.assertRaises(ValueError):
            self.archive()
        self.assertEqual(self.query("SELECT * FROM keep"), [("preserved",)])
        self.assertEqual(self.query("PRAGMA user_version"), [(99,)])

    def test_backup_restore_reopens_consistent_database_and_rotates_only_own_files(self):
        self.archive()
        backups = self.database.parent / "backups"
        backups.mkdir()
        unrelated = backups / "keep.sqlite"
        unrelated.write_text("keep")
        for days in range(5):
            backup_database(self.database, now=NOW + dt.timedelta(days=days))
        files = sorted(backups.glob("paper-history-????-??-??.sqlite"))
        self.assertEqual(len(files), 3)
        self.assertTrue(unrelated.exists())
        restored = self.root / "restored.sqlite"
        restored.write_bytes(files[-1].read_bytes())
        self.assertEqual(database_status(restored)["orders"], 1)
        self.assertEqual(database_status(restored)["integrity"], "ok")

    def test_status_reads_existing_database_without_mutating_it(self):
        self.archive()
        before = self.database.read_bytes()
        result = database_status(self.database)
        self.assertEqual(result["schemaVersion"], 1)
        self.assertEqual(result["integrity"], "ok")
        self.assertEqual(before, self.database.read_bytes())

    def test_archive_must_not_use_source_as_database(self):
        before = self.source.read_bytes()
        with self.assertRaises(ValueError):
            archive_once(self.source, self.source, now=NOW)
        self.assertEqual(before, self.source.read_bytes())

    def test_capacity_failure_rolls_back_whole_batch(self):
        self.archive()
        pages = self.query("PRAGMA page_count")[0][0]
        self.input["orders"] = [dict(order(), id=f"PO-{index}") for index in range(1000)]
        self.write()
        with patch("paper_history.MAX_DATABASE_PAGES", pages + 1):
            with self.assertRaises(sqlite3.DatabaseError):
                self.archive()
        self.assertEqual(self.query("SELECT id FROM orders"), [("PO-1",)])
        self.assertEqual(self.query("SELECT COUNT(*) FROM account_samples"), [(1,)])
        self.assertEqual(database_status(self.database)["integrity"], "ok")

    def test_corrupt_database_is_not_replaced_or_treated_as_empty(self):
        self.database.parent.mkdir()
        self.database.write_bytes(b"not a SQLite file")
        before = self.database.read_bytes()
        with self.assertRaises(sqlite3.DatabaseError):
            self.archive()
        self.assertEqual(self.database.read_bytes(), before)

    def test_final_order_never_regresses_to_pending_after_stale_source_restore(self):
        pending = copy.deepcopy(self.input)
        self.input["orders"][0].update(status="filled", updatedAt="2026-11-09T14:01:00Z")
        self.write()
        self.archive()
        self.input = pending
        self.write()
        self.archive()
        self.assertEqual(self.query("SELECT status FROM orders"), [("filled",)])

    def test_archives_bounded_blocker_categories_without_raw_rule_text(self):
        data = self.input["auditEvents"][0]["data"]
        data["blockedReasons"] = {"lot-size: blocked": 2,
            "entry-persistence: blocked (DO_NOT_ARCHIVE)": 1,
            "raw: DO_NOT_ARCHIVE": 99}
        data["researchDiagnostics"] = {"sectorCount": 6, "stockCount": 4, "usableStockCount": 1,
            "issues": ["provider-timeout", "DO_NOT_ARCHIVE", "provider-timeout"]}
        self.write()
        self.archive()
        details = self.query("SELECT details_json FROM execution_runs")[0][0]
        self.assertNotIn("DO_NOT_ARCHIVE", details)
        result = json.loads(details)
        self.assertEqual(result["blockers"], {"lot-size": 2, "entry-persistence": 1})
        self.assertEqual(result["researchDiagnostics"]["issues"], ["provider-timeout"])


if __name__ == "__main__":
    unittest.main()
