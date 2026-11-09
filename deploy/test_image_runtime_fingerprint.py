import copy
import unittest

from image_runtime_fingerprint import runtime_fingerprint


def image():
    return dict(Id="sha256:old-proof", Created="2026-11-09T13:00:00Z",
                RepoTags=["bridge:production"], RepoDigests=["bridge@sha256:old"],
                Config=dict(Env=["TZ=Asia/Shanghai"], Cmd=["python", "main.py"],
                            User="", Healthcheck=dict(Test=["CMD", "python", "health.py"])),
                RootFS=dict(Type="layers", Layers=["sha256:base", "sha256:app"]),
                Os="linux", Architecture="amd64")


class RuntimeFingerprintTests(unittest.TestCase):
    def test_new_proof_identity_and_creation_metadata_do_not_change_runtime(self):
        old = image()
        new = dict(old, Id="sha256:new-proof", Created="later", RepoTags=["bridge:rollback"],
                   RepoDigests=["bridge@sha256:new"], Metadata={"LastTagTime": "later"})
        self.assertEqual(runtime_fingerprint([old]), runtime_fingerprint([new]))

    def test_object_key_order_does_not_change_runtime(self):
        old = image()
        new = copy.deepcopy(old)
        new["Config"] = dict(reversed(list(old["Config"].items())))
        self.assertEqual(runtime_fingerprint([old]), runtime_fingerprint([new]))

    def test_runtime_configuration_or_layers_must_change_fingerprint(self):
        for field, value in (("Cmd", ["python", "other.py"]), ("Env", ["TZ=UTC"]),
                             ("User", "1000"), ("Entrypoint", ["/start.sh"]),
                             ("Healthcheck", {"Test": ["CMD", "false"]}), ("Labels", {"release": "new"})):
            with self.subTest(field=field):
                old, new = image(), image()
                new["Config"][field] = value
                self.assertNotEqual(runtime_fingerprint([old]), runtime_fingerprint([new]))
        new = image()
        new["RootFS"]["Layers"].append("sha256:new-program")
        self.assertNotEqual(runtime_fingerprint([image()]), runtime_fingerprint([new]))

    def test_platform_and_layer_order_are_material(self):
        for field, value in (("Os", "windows"), ("Architecture", "arm64"), ("Variant", "v8"),
                             ("OsVersion", "new"), ("OsFeatures", ["feature"])):
            with self.subTest(field=field):
                new = dict(image(), **{field: value})
                self.assertNotEqual(runtime_fingerprint([image()]), runtime_fingerprint([new]))
        new = image()
        new["RootFS"]["Layers"].reverse()
        self.assertNotEqual(runtime_fingerprint([image()]), runtime_fingerprint([new]))

    def test_invalid_or_ambiguous_inspect_output_fails_closed(self):
        for value in (None, {}, [], [image(), image()], [{}], [dict(image(), Config=None)],
                      [dict(image(), RootFS=None)], [dict(image(), RootFS={})],
                      [dict(image(), RootFS={"Type": "layers", "Layers": None})]):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    runtime_fingerprint(value)


if __name__ == "__main__":
    unittest.main()
