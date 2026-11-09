"""Exercise the actual deployment shell in a private Linux tree with fake Docker.

No production paths, Docker daemon, network requests or real rollback are used.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest

COMMIT = "b" * 40
REPOSITORY = Path(__file__).resolve().parent.parent
FAKE_DOCKER = r'''#!/usr/bin/env python3
import json,os,pathlib,sys
statefile=pathlib.Path(os.environ['FAKE_STATE'])
s=json.loads(statefile.read_text());a=sys.argv[1:];code=0;output=''
def record(kind,**values): s['events'].append(dict(kind=kind,**values))
if a[:2]==['image','inspect']:
 name=a[-1]
 if name not in s['tags']: code=1
 else:
  data=s['tags'][name]
  output=json.dumps([data])
elif a[:2]==['image','tag']:
 s['tags'][a[3]]=s['tags'][a[2]]
 record('tag',source=a[2],target=a[3])
elif a[:2]==['image','rm']:
 s['tags'].pop(a[2],None)
elif a[:2]==['image','prune']: pass
elif a[:1]==['inspect']: output='healthy'
elif a[:1]==['compose']:
 args=a[a.index('-f')+2:];command=args[0]
 if command=='config': pass
 elif command=='build':
  for name in ['kairos-akshare-bridge','kairos-api','kairos-web']:
   old=s['tags'][name+':production'];new=dict(old,Id='new-'+name,Created='later')
   if name=='kairos-api': new['RootFS']={'Type':'layers','Layers':['new-api-code']}
   if os.environ.get('FAKE_FAIL')=='bridge-config-change' and name=='kairos-akshare-bridge': new['Config']={'Cmd':['changed-start']}
   if os.environ.get('FAKE_FAIL')=='fingerprint' and name=='kairos-web': new.pop('Config')
   s['tags'][name+':production']=new
  if os.environ.get('FAKE_FAIL')=='build': code=1
 elif command=='up':
  config=pathlib.Path(a[a.index('-f')+1]).read_text().strip()
  record('up',config=config,tags={key:value['Id'] for key,value in s['tags'].items() if key.endswith(':production')})
  if os.environ.get('FAKE_FAIL')=='up' and config=='new-compose': code=1
 elif command=='ps': output='fake-container'
 elif command=='logs': pass
 else: code=2
else: code=2
statefile.write_text(json.dumps(s))
if output: print(output)
sys.exit(code)
'''


@unittest.skipUnless(os.name == "posix" and shutil.which("bash") and shutil.which("flock"), "Linux deployment contract")
class DeploymentFlowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="kairos-deploy-contract-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.root = self.base / "production"
        self.control = self.base / "control"
        self.root.mkdir()
        self.control.mkdir()
        (self.root / "runtime").mkdir()
        (self.root / "runtime" / "keep.json").write_text("protected runtime")
        (self.root / ".env.production").write_text("protected environment")
        (self.root / "docker-compose.production.yml").write_text("old-compose")
        (self.root / "old-source.txt").write_text("old source")
        self.statefile = self.control / "state.json"
        tags = {name + ":production": dict(Id="old-" + name, Config={"Cmd": ["start"]},
            RootFS={"Type": "layers", "Layers": [name]}, Os="linux", Architecture="amd64")
            for name in ("kairos-akshare-bridge", "kairos-api", "kairos-web")}
        self.statefile.write_text(json.dumps(dict(tags=tags, events=[])))
        binaries = self.control / "bin"
        binaries.mkdir()
        for name, source in (("docker", FAKE_DOCKER), ("curl", "#!/bin/sh\nexit 0\n"),
                             ("git", "#!/bin/sh\nexit 1\n")):
            target = binaries / name
            target.write_text(source)
            target.chmod(0o700)
        self.env = dict(os.environ, FAKE_STATE=str(self.statefile), PATH=str(binaries) + os.pathsep + os.environ["PATH"])
        self.script = self.control / "run-deployment.sh"
        self.source = (REPOSITORY / "deploy/update-server.sh").read_text()
        self.source = self.source.replace("/tmp/kairos-", str(self.control / "kairos-"))
        self.source = self.source.replace("ROOT=/opt/kairos", "ROOT=" + str(self.root))
        new = self.release = self.control / "release"
        (new / "deploy").mkdir(parents=True)
        for name in ("Dockerfile", "package.json"):
            (new / name).write_text("required release file")
        (new / "docker-compose.production.yml").write_text("new-compose")
        (new / "deploy/update-server.sh").write_text(self.source)
        (new / "deploy/github-deploy-entrypoint.sh").write_text("required entrypoint")
        shutil.copyfile(REPOSITORY / "deploy/image_runtime_fingerprint.py", new / "deploy/image_runtime_fingerprint.py")
        self.write_archive()

    def write_archive(self):
        with tarfile.open(self.control / ("kairos-release-" + COMMIT + ".tar.gz"), "w:gz") as archive:
            for file in self.release.rglob("*"):
                archive.add(file, arcname=str(file.relative_to(self.release)), recursive=False)

    def run_deployment(self, failure=""):
        source = self.source
        if failure == "health":
            source = source.replace("deadline=$((SECONDS + 360))", "deadline=$((SECONDS + 0))")
        self.script.write_text(source)
        result = subprocess.run(["bash", str(self.script), COMMIT], env=dict(self.env, FAKE_FAIL=failure),
                                capture_output=True, text=True, timeout=15)
        self.assertEqual((self.root / "runtime/keep.json").read_text(), "protected runtime")
        self.assertEqual((self.root / ".env.production").read_text(), "protected environment")
        return result, json.loads(self.statefile.read_text())

    def test_success_reuses_unchanged_runtime_images_and_activates_changed_api(self):
        result, state = self.run_deployment()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / "docker-compose.production.yml").read_text(), "new-compose")
        active = state["tags"]
        self.assertEqual(active["kairos-akshare-bridge:production"]["Id"], "old-kairos-akshare-bridge")
        self.assertEqual(active["kairos-web:production"]["Id"], "old-kairos-web")
        self.assertEqual(active["kairos-api:production"]["Id"], "new-kairos-api")

    def test_failed_build_restores_source_before_restarting_old_images(self):
        self.assert_failed_flow("build")

    def test_failed_up_restores_source_before_restarting_old_images(self):
        self.assert_failed_flow("up")

    def test_failed_health_restores_source_before_restarting_old_images(self):
        self.assert_failed_flow("health")

    def test_failed_fingerprint_restores_source_before_restarting_old_images(self):
        self.assert_failed_flow("fingerprint")

    def test_changed_bridge_runtime_is_activated(self):
        result, state = self.run_deployment("bridge-config-change")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(state["tags"]["kairos-akshare-bridge:production"]["Id"], "new-kairos-akshare-bridge")

    def test_known_older_archive_without_helper_keeps_standard_activation(self):
        (self.release / "deploy/image_runtime_fingerprint.py").unlink()
        self.write_archive()
        result, state = self.run_deployment()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("standard activation", result.stdout)
        self.assertEqual(state["tags"]["kairos-akshare-bridge:production"]["Id"], "new-kairos-akshare-bridge")

    def test_invalid_success_output_from_helper_cannot_authorize_image_reuse(self):
        (self.release / "deploy/image_runtime_fingerprint.py").write_text("print('invalid-fingerprint')\n")
        self.write_archive()
        self.assert_failed_flow("invalid-helper")

    def assert_failed_flow(self, failure):
        result, state = self.run_deployment(failure)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertEqual((self.root / "docker-compose.production.yml").read_text(), "old-compose")
        self.assertEqual((self.root / "old-source.txt").read_text(), "old source")
        starts = [event for event in state["events"] if event["kind"] == "up"]
        self.assertTrue(starts, result.stderr)
        last_up = starts[-1]
        self.assertEqual(last_up["config"], "old-compose")
        self.assertTrue(all(value.startswith("old-") for value in last_up["tags"].values()))


if __name__ == "__main__":
    unittest.main()
