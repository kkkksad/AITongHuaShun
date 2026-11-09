"""Capacity checks never modify Docker, source, or account state."""
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import deployment_capacity as capacity


class DeploymentCapacityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="kairos-capacity-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.docker_root = self.root / "docker-data"
        self.docker_root.mkdir()

    def usage(self, free):
        return shutil._ntuple_diskusage(total=40 * 1024 ** 3, used=40 * 1024 ** 3 - free, free=free)

    def check(self, values):
        with patch.object(capacity, "docker_storage_root", return_value=self.docker_root), \
                patch.object(capacity.shutil, "disk_usage", side_effect=values):
            return capacity.check_capacity(self.root)

    def test_accepts_the_exact_four_gib_boundary_without_combining_filesystems(self):
        result = self.check([self.usage(4 * 1024 ** 3), self.usage(4 * 1024 ** 3)])
        self.assertTrue(result["ok"])
        self.assertEqual(result["minimumFreeBytes"], 4 * 1024 ** 3)
        self.assertEqual([item["freeBytes"] for item in result["filesystems"]], [4 * 1024 ** 3] * 2)
        self.assertNotIn("totalFreeBytes", result)

    def test_application_space_one_byte_below_threshold_stops_even_with_a_large_docker_disk(self):
        with self.assertRaisesRegex(ValueError, "application"):
            self.check([self.usage(4 * 1024 ** 3 - 1), self.usage(20 * 1024 ** 3)])

    def test_docker_space_one_byte_below_threshold_stops_even_with_a_large_application_disk(self):
        with self.assertRaisesRegex(ValueError, "docker"):
            self.check([self.usage(20 * 1024 ** 3), self.usage(4 * 1024 ** 3 - 1)])

    def test_does_not_add_two_insufficient_readings_from_the_same_disk(self):
        with patch.object(capacity, "docker_storage_root", return_value=self.root), \
                patch.object(capacity.shutil, "disk_usage", return_value=self.usage(3 * 1024 ** 3)):
            with self.assertRaisesRegex(ValueError, "Insufficient"):
                capacity.check_capacity(self.root)

    def test_unreadable_docker_storage_stops_instead_of_falling_back_to_application_disk(self):
        with self.assertRaises(PermissionError):
            self.check([self.usage(10 * 1024 ** 3), PermissionError("unreadable Docker storage")])

    def test_missing_application_root_stops_before_docker_lookup(self):
        with patch.object(capacity, "docker_storage_root") as lookup:
            with self.assertRaises(ValueError):
                capacity.check_capacity(self.root / "missing")
        lookup.assert_not_called()

    def test_file_as_application_root_is_invalid(self):
        path = self.root / "file"
        path.write_text("source")
        with self.assertRaises(ValueError):
            capacity.check_capacity(path)

    def test_docker_root_lookup_uses_a_readonly_bounded_command(self):
        with patch.object(capacity.subprocess, "check_output", return_value=str(self.docker_root) + "\n") as command:
            self.assertEqual(capacity.docker_storage_root(), self.docker_root)
        self.assertEqual(command.call_args.args[0], ["docker", "info", "--format", "{{.DockerRootDir}}"])
        self.assertEqual(command.call_args.kwargs["timeout"], 15)

    def test_invalid_docker_storage_paths_are_rejected(self):
        for value in ["", "relative/path", "a\nb", str(self.root / "missing")]:
            with self.subTest(value=value), patch.object(capacity.subprocess, "check_output", return_value=value):
                with self.assertRaises(ValueError):
                    capacity.docker_storage_root()


if __name__ == "__main__":
    unittest.main()
