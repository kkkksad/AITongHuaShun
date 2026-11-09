import datetime as dt
from contextlib import redirect_stdout
from io import StringIO
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

from paper_history import archive_once, main
from paper_history_read_model import build_read_model, publish_read_model
from test_paper_history import state, NOW, EPOCH, OTHER_EPOCH


class PaperHistoryReadModelTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.source = self.root / 'source.json'
        self.database = self.root / 'archive' / 'history.sqlite'
        self.input = state()

    def archive(self):
        self.source.write_text(json.dumps(self.input), encoding='utf8')
        archive_once(self.source, self.database, now=NOW)

    def run_record(self, identity, time, **data):
        return dict(id=identity, action='paper-auto-execution.run', timestamp=time, data=data)

    def build(self, now=NOW):
        return build_read_model(self.database, self.input['accountId'], EPOCH, now=now)

    def test_groups_real_runs_without_turning_unknown_session_or_missing_counts_into_zero_evidence(self):
        self.input['auditEvents'] = [
            self.run_record('AE-1', '2026-11-09T14:00:00Z', session='open', submittedOrders=2,
                            blockedReasons={'cash-check: blocked': 3}, researchDiagnostics={'issues': ['history-warming']}),
            self.run_record('AE-2', '2026-11-09T14:01:00Z', session='after-hours', submittedOrders=0),
            self.run_record('AE-3', '2026-11-09T14:02:00Z', token='DO_NOT_PUBLISH', error='DO_NOT_PUBLISH'),
        ]
        self.archive()
        result = self.build()
        self.assertEqual((result['runCount'], result['openSessionRuns'], result['unknownSessionRuns']), (3, 1, 1))
        self.assertEqual((result['submittedAttempts'], result['submissionEvidenceRuns']), (2, 2))
        self.assertEqual(result['blockers'], [{'code': 'cash-check', 'count': 3}])
        self.assertEqual(result['issues'], [{'code': 'history-warming', 'count': 1}])
        self.assertNotIn('DO_NOT_PUBLISH', json.dumps(result))
        self.assertEqual(len(result['days']), 7)

    def test_uses_beijing_seven_date_window_and_ignores_future_evidence(self):
        self.input['auditEvents'] = [
            self.run_record('before-window', '2026-11-02T15:59:59.999Z', session='open'),
            self.run_record('start', '2026-11-02T16:00:00Z', session='open'),
            self.run_record('before-midnight', '2026-11-08T15:59:59.999Z', session='open'),
            self.run_record('after-midnight', '2026-11-08T16:00:00Z', session='open'),
            self.run_record('exact', NOW.isoformat(), session='open'),
            self.run_record('future', (NOW + dt.timedelta(milliseconds=1)).isoformat(), session='open'),
        ]
        self.archive()
        result = self.build()
        self.assertEqual(result['window'], {'fromDate': '2026-11-03', 'toDate': '2026-11-09'})
        self.assertEqual(result['runCount'], 4)
        self.assertEqual([(day['date'], day['runs']) for day in result['days'] if day['runs']],
                         [('2026-11-03', 1), ('2026-11-08', 1), ('2026-11-09', 2)])

    def test_keeps_reset_epochs_separate_even_when_account_id_and_cash_are_identical(self):
        self.archive()
        self.input['accountEpoch'] = OTHER_EPOCH
        self.input['auditEvents'] = [self.run_record('new-epoch', '2026-11-09T14:30:00Z', submittedOrders=7)]
        self.archive()
        self.assertEqual(self.build()['submittedAttempts'], 0)
        other = build_read_model(self.database, self.input['accountId'], OTHER_EPOCH, now=NOW)
        self.assertEqual(other['submittedAttempts'], 7)
        with self.assertRaises(ValueError):
            build_read_model(self.database, 'PAPER-OTHER', EPOCH, now=NOW)

    def test_is_readonly_and_repeated_observation_does_not_duplicate_evidence(self):
        self.archive()
        first = self.build()
        before = self.source.read_bytes()
        self.archive()
        self.assertEqual(self.build(), first)
        self.assertEqual(self.source.read_bytes(), before)

    def test_only_returns_latest_twenty_rows_but_aggregates_the_full_window(self):
        self.input['auditEvents'] = [self.run_record('run-' + str(index),
            (NOW - dt.timedelta(minutes=index)).isoformat(), submittedOrders=1) for index in range(25)]
        self.archive()
        result = self.build()
        self.assertEqual(result['runCount'], 25)
        self.assertEqual(result['submittedAttempts'], 25)
        self.assertEqual(len(result['latestRuns']), 20)
        self.assertEqual(result['latestRuns'][0]['occurredAt'], '2026-11-09T15:00:00.000Z')

    def test_excessive_window_fails_without_publishing_a_truncated_report(self):
        self.archive()
        with patch('paper_history_read_model.MAX_RUNS', 0):
            with self.assertRaises(ValueError):
                self.build()

    def test_atomic_publish_failure_preserves_the_previous_model(self):
        self.archive()
        target = publish_read_model(self.database, self.input['accountId'], EPOCH, now=NOW)
        before = target.read_bytes()
        with patch.object(pathlib.Path, 'replace', side_effect=OSError('injected')):
            with self.assertRaises(OSError):
                publish_read_model(self.database, self.input['accountId'], EPOCH, now=NOW + dt.timedelta(minutes=1))
        self.assertEqual(target.read_bytes(), before)
        self.assertEqual([path.name for path in target.parent.iterdir()], ['current.json'])

    def test_unknown_enums_and_unlisted_fields_do_not_reach_the_model(self):
        self.input['auditEvents'] = [self.run_record('bad-enums', '2026-11-09T14:00:00Z',
            session='DO_NOT_PUBLISH', phase='DO_NOT_PUBLISH', regime='DO_NOT_PUBLISH',
            blockedReasons={'DO_NOT_PUBLISH: blocked': 5})]
        self.archive()
        result = self.build()
        self.assertEqual(result['unknownSessionRuns'], 1)
        self.assertEqual(result['blockers'], [])
        self.assertNotIn('DO_NOT_PUBLISH', json.dumps(result))

    def test_collector_main_publishes_the_actual_current_epoch_after_sampling(self):
        self.source.write_text(json.dumps(self.input), encoding='utf8')
        arguments = ['paper_history.py', '--source', str(self.source), '--database', str(self.database)]
        with patch('sys.argv', arguments), redirect_stdout(StringIO()):
            self.assertEqual(main(), 0)
        result = json.loads((self.database.parent / 'read-model/current.json').read_text(encoding='utf8'))
        self.assertEqual(result['accountEpoch'], EPOCH)
        self.assertEqual(result['runCount'], 1)
        self.assertEqual(json.loads((self.database.parent / 'status.json').read_text())['readModelStatus'], 'published')

    def test_projection_failure_keeps_database_sampling_success_and_the_previous_projection(self):
        self.archive()
        target = publish_read_model(self.database, self.input['accountId'], EPOCH, now=NOW)
        before = target.read_bytes()
        arguments = ['paper_history.py', '--source', str(self.source), '--database', str(self.database)]
        with patch('sys.argv', arguments), patch('paper_history_read_model.publish_read_model', side_effect=OSError('injected')), redirect_stdout(StringIO()):
            self.assertEqual(main(), 0)
        self.assertEqual(target.read_bytes(), before)
        self.assertEqual(json.loads((self.database.parent / 'status.json').read_text())['readModelStatus'], 'unavailable')

    @unittest.skipUnless(__import__('os').name == 'posix', 'Linux symlink contract')
    def test_rejects_symlink_publication_directory_without_touching_the_target(self):
        self.archive()
        outside = self.root / 'outside'; outside.mkdir()
        (self.database.parent / 'read-model').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            publish_read_model(self.database, self.input['accountId'], EPOCH, now=NOW)
        self.assertEqual(list(outside.iterdir()), [])

    @unittest.skipUnless(__import__('os').name == 'posix', 'Linux symlink contract')
    def test_rejects_symlink_publication_file_without_touching_the_target(self):
        self.archive()
        folder = self.database.parent / 'read-model'; folder.mkdir()
        outside = self.root / 'outside.json'; outside.write_text('keep')
        (folder / 'current.json').symlink_to(outside)
        with self.assertRaises(ValueError):
            publish_read_model(self.database, self.input['accountId'], EPOCH, now=NOW)
        self.assertEqual(outside.read_text(), 'keep')


if __name__ == '__main__':
    unittest.main()
