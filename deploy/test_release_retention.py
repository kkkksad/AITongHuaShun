"""Retained release tests use private files and an in-memory Docker replacement."""
import copy
import hashlib
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import release_retention as retention


def image(label):
    return dict(Id="sha256:" + hashlib.sha256(label.encode()).hexdigest(), Config={"Cmd": [label]},
                RootFS={"Type": "layers", "Layers": ["sha256:" + hashlib.sha256(label.encode()).hexdigest()]},
                Os="linux", Architecture="amd64")


class RetainedReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="kairos-retention-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "app"
        self.root.mkdir()
        (self.root / "runtime/data").mkdir(parents=True)
        (self.root / "runtime/data/paper.json").write_text("funds stay here")
        (self.root / ".env.production").write_text("do not archive this")
        (self.root / ".env.private").write_text("do not archive this either")
        (self.root / ".env.example").write_text("PUBLIC_TEMPLATE=true")
        (self.root / "docker-compose.production.yml").write_text("old-compose")
        (self.root / "app.ts").write_text("old source")
        self.tags = {name + ":production": image(name + "-old") for name in retention.IMAGES}
        self.calls = []
        self.fail_tag = None
        self.patch = patch.object(retention, "docker", side_effect=self.docker)
        self.patch.start(); self.addCleanup(self.patch.stop)

    def docker(self, *args):
        self.calls.append(args)
        if args[:1] == ("compose",): return args[-1]
        if args[:1] == ("inspect",):
            name = dict(zip(("akshare-bridge", "backend", "web"), retention.IMAGES))[args[1]]
            return [dict(Image=self.tags[name + ":production"]["Id"], State={"Health": {"Status": "healthy"}})]
        if args[:2] == ("image", "inspect"):
            if args[2] not in self.tags:
                raise RuntimeError("fixture missing image")
            return [copy.deepcopy(self.tags[args[2]])]
        if args[:2] == ("image", "tag"):
            if self.fail_tag and args[3].startswith(self.fail_tag):
                raise RuntimeError("fixture tag failure")
            source = next((item for item in self.tags.values() if item["Id"] == args[2]), None)
            if source is None:
                raise RuntimeError("fixture source missing")
            self.tags[args[3]] = copy.deepcopy(source)
            return None
        if args[:2] == ("image", "rm"):
            self.tags.pop(args[2], None)
            return None
        raise AssertionError(args)

    def stage(self, commit="b" * 40):
        return retention.stage(self.root, commit)

    def activate(self, slot, commit="b" * 40):
        (self.root / "app.ts").write_text(commit)
        for name in retention.IMAGES:
            self.tags[name + ":production"] = image(name + commit)
        return retention.promote(self.root, slot, commit)

    def test_retains_matching_source_images_and_excludes_all_private_runtime_material(self):
        slot = self.stage()
        self.activate(slot)
        result = retention.verify(self.root)
        self.assertEqual(result["previous"]["slot"], slot)
        archive = self.root / "runtime/releases" / slot / "source.tar.gz"
        with tarfile.open(archive) as source:
            names = source.getnames()
            self.assertIn("app.ts", names)
            self.assertIn(".env.example", names)
            self.assertNotIn(".env.production", names)
            self.assertNotIn(".env.private", names)
            self.assertFalse(any(name.startswith("runtime") for name in names))
            self.assertEqual(source.extractfile("app.ts").read(), b"old source")
        self.assertEqual((self.root / "runtime/data/paper.json").read_text(), "funds stay here")
        self.assertEqual((self.root / ".env.production").read_text(), "do not archive this")

    def test_abort_leaves_previous_slot_and_current_metadata_unchanged(self):
        first = self.stage(); self.activate(first)
        before = retention.verify(self.root)
        second = self.stage("c" * 40)
        retention.abort(self.root, second)
        self.assertEqual(retention.verify(self.root), before)
        self.assertFalse((self.root / "runtime/releases" / second).exists())
        self.assertFalse(any(second in tag for tag in self.tags))

    def test_repeat_of_identical_current_commit_does_not_replace_previous(self):
        first = self.stage(); self.activate(first)
        self.assertEqual(self.stage(), "unchanged")
        self.activate("unchanged")
        self.assertEqual(retention.verify(self.root)["previous"]["slot"], first)

    def test_new_release_rotates_only_after_new_previous_is_fully_verified(self):
        first = self.stage(); self.activate(first)
        second = self.stage("c" * 40)
        self.assertTrue((self.root / "runtime/releases" / first).exists())
        self.assertEqual(retention.verify(self.root)["previous"]["slot"], first)
        self.activate(second, "c" * 40)
        self.assertEqual(retention.verify(self.root)["previous"]["slot"], second)
        self.assertFalse((self.root / "runtime/releases" / first).exists())
        self.assertFalse(any(first in tag for tag in self.tags))

    def test_unrecognized_legacy_identity_remains_unknown(self):
        slot = self.stage(); self.activate(slot)
        self.assertIsNone(retention.verify(self.root)["previous"]["commit"])

    def test_first_verify_does_not_create_any_files_or_directories(self):
        with self.assertRaises(ValueError): retention.verify(self.root)
        self.assertFalse((self.root / "runtime/releases").exists())

    def test_staged_assets_cannot_be_promoted_for_a_different_incoming_commit(self):
        slot = self.stage()
        with self.assertRaises(ValueError): self.activate(slot, "c" * 40)
        self.assertFalse((self.root / "runtime/releases/index.json").exists())

    def test_tampered_source_does_not_silently_reuse_the_same_commit_identity(self):
        first = self.stage(); self.activate(first)
        (self.root / "app.ts").write_text("unrecorded local edit")
        slot = self.stage()
        self.assertNotEqual(slot, "unchanged")
        self.activate(slot)
        self.assertIsNone(retention.verify(self.root)["previous"]["commit"])

    def test_generated_python_caches_do_not_change_source_identity_or_enter_archives(self):
        first = self.stage(); self.activate(first)
        cache = self.root / "__pycache__"; cache.mkdir()
        (cache / "helper.pyc").write_bytes(b"generated cache")
        (self.root / "old.pyc").write_bytes(b"another cache")
        self.assertEqual(self.stage(), "unchanged")
        slot = self.stage("c" * 40); self.activate(slot, "c" * 40)
        with tarfile.open(self.root / "runtime/releases" / slot / "source.tar.gz") as archive:
            self.assertFalse(any(name.endswith(".pyc") for name in archive.getnames()))

    def test_private_env_directories_are_never_traversed(self):
        private = self.root / ".env.private-directory"; private.mkdir()
        (private / "secret.txt").write_text("private")
        slot = self.stage(); self.activate(slot)
        with tarfile.open(self.root / "runtime/releases" / slot / "source.tar.gz") as archive:
            self.assertFalse(any("secret" in name for name in archive.getnames()))

    def test_failed_index_replacement_preserves_old_previous(self):
        first = self.stage(); self.activate(first)
        second = self.stage("c" * 40)
        with patch.object(retention, "atomic_json", side_effect=OSError("fixture full disk")):
            with self.assertRaises(OSError): self.activate(second, "c" * 40)
        self.assertEqual(retention.verify(self.root)["previous"]["slot"], first)

    def test_invalid_explicit_current_image_records_are_preserved_and_rejected(self):
        slot = self.stage(); self.activate(slot)
        file = self.root / "runtime/releases/index.json"
        data = json.loads(file.read_text()); data["current"]["images"] = []
        file.write_text(json.dumps(data)); before = file.read_bytes()
        with self.assertRaises(ValueError): self.stage("c" * 40)
        self.assertEqual(file.read_bytes(), before)

    def test_old_cleanup_failure_does_not_undo_the_committed_new_previous(self):
        first = self.stage(); self.activate(first)
        second = self.stage("c" * 40)
        with patch.object(retention, "remove_slot", side_effect=OSError("fixture cleanup failure")):
            self.activate(second, "c" * 40)
        self.assertEqual(retention.verify(self.root)["previous"]["slot"], second)
        self.assertTrue((self.root / "runtime/releases" / first).exists())

    def test_interrupted_slots_are_bounded_and_never_silently_removed(self):
        for i in range(4):
            (self.root / "runtime/releases" / ("release-" + str(i) * 16)).mkdir(parents=True)
        with self.assertRaises(ValueError): self.stage()
        self.assertEqual(len(list((self.root / "runtime/releases").iterdir())), 4)

    def test_missing_production_image_fails_before_creating_a_slot(self):
        self.tags.pop(retention.IMAGES[-1] + ":production")
        with self.assertRaises(RuntimeError): self.stage()
        self.assertFalse(any(":retained-" in tag for tag in self.tags))

    def test_partial_tag_failure_cleans_only_the_new_slot_and_tags(self):
        self.fail_tag = retention.IMAGES[1] + ":retained-"
        with self.assertRaises(RuntimeError): self.stage()
        self.assertFalse(any(":retained-" in tag for tag in self.tags))

    def test_missing_retained_image_fails_verification_and_does_not_rotate_previous(self):
        first = self.stage(); self.activate(first)
        second = self.stage("c" * 40)
        self.tags.pop(retention.IMAGES[0] + ":retained-" + second)
        with self.assertRaises(RuntimeError): self.activate(second, "c" * 40)
        self.assertEqual(json.loads((self.root / "runtime/releases/index.json").read_text())["previous"], first)

    def test_corrupt_archive_is_detected_before_promotion(self):
        slot = self.stage()
        (self.root / "runtime/releases" / slot / "source.tar.gz").write_bytes(b"corrupt")
        with self.assertRaises(ValueError): self.activate(slot)
        self.assertFalse((self.root / "runtime/releases/index.json").exists())

    def test_retargeted_image_is_detected_even_if_the_tag_still_exists(self):
        slot = self.stage()
        self.tags[retention.IMAGES[0] + ":retained-" + slot] = image("wrong image")
        with self.assertRaises(ValueError): self.activate(slot)

    def test_invalid_slot_and_manifest_paths_cannot_escape_release_directory(self):
        for value in ("../outside", "/tmp", "", "retained-123", "f" * 32):
            with self.subTest(value=value):
                with self.assertRaises(ValueError): retention.abort(self.root, value)

    def test_symlink_source_is_rejected_before_archiving_external_content(self):
        outside = Path(self.temp.name) / "outside.txt"
        outside.write_text("external secret")
        try: (self.root / "linked.txt").symlink_to(outside)
        except OSError: self.skipTest("symlink capability unavailable")
        with self.assertRaises(ValueError): self.stage()
        self.assertEqual(outside.read_text(), "external secret")

    def test_symlink_release_root_is_rejected(self):
        outside = Path(self.temp.name) / "external-releases"; outside.mkdir()
        try: (self.root / "runtime/releases").symlink_to(outside, target_is_directory=True)
        except OSError: self.skipTest("symlink capability unavailable")
        with self.assertRaises(ValueError): self.stage()
        self.assertEqual(list(outside.iterdir()), [])

    def test_manifest_cannot_authorize_deletion_of_an_unrelated_docker_tag(self):
        slot = self.stage()
        file = self.root / "runtime/releases" / slot / "manifest.json"
        data = json.loads(file.read_text()); data["images"][0]["tag"] = "other-app:production"
        file.write_text(json.dumps(data))
        with self.assertRaises(ValueError): retention.abort(self.root, slot)
        self.assertNotIn(("image", "rm", "other-app:production"), self.calls)

    def test_export_verifies_the_previous_archive_and_does_not_overwrite_a_file(self):
        slot = self.stage(); self.activate(slot)
        target = Path(self.temp.name) / "export.tar.gz"
        retention.export_previous(self.root, target)
        self.assertEqual(target.read_bytes(), (self.root / "runtime/releases" / slot / "source.tar.gz").read_bytes())
        with self.assertRaises(FileExistsError): retention.export_previous(self.root, target)


if __name__ == "__main__":
    unittest.main()
