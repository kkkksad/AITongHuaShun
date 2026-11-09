"""Exercise the actual deployment shell in a private Linux tree with fake Docker.

No production paths, Docker daemon, network requests or real rollback are used.
"""
import hashlib
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
import hashlib,json,os,pathlib,sys
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
 item=s['tags'].get(a[2]) or next((v for v in s['tags'].values() if v['Id']==a[2]),None)
 if item is None: code=1
 else:
  s['tags'][a[3]]=item
  record('tag',source=a[2],target=a[3])
elif a[:2]==['image','rm']:
 s['tags'].pop(a[2],None)
elif a[:2]==['image','prune']: record('host-prune')
elif a[:1]==['inspect']:
 if '--format' in a: output='healthy'
 else:
  service=next((k for k,v in s['containers'].items() if v==a[-1]),None)
  output=json.dumps([dict(Image=s['container_images'].get(service),State={'Health':{'Status':'healthy'}})])
elif a[:1]==['exec']: output=s['nginx_digest']+'  /etc/nginx/conf.d/default.conf'
elif a[:1]==['compose']:
 args=a[a.index('-f')+2:];command=args[0]
 if command=='config': pass
 elif command=='build':
  for name in ['kairos-akshare-bridge','kairos-api','kairos-web']:
   old=s['tags'][name+':production'];new=dict(old,Id='new-'+name,Created='later')
   if name=='kairos-api' and os.environ.get('FAKE_FAIL')!='metadata-only': new['RootFS']={'Type':'layers','Layers':['new-api-code']}
   if os.environ.get('FAKE_FAIL')=='bridge-config-change' and name=='kairos-akshare-bridge': new['Config']={'Cmd':['changed-start']}
   if os.environ.get('FAKE_FAIL')=='fingerprint' and name=='kairos-web': new.pop('Config')
   if os.environ.get('FAKE_REAL_IDS'):
    new['Id']='sha256:'+hashlib.sha256(json.dumps([new.get('Config'),new['RootFS']],sort_keys=True).encode()).hexdigest()
   s['tags'][name+':production']=new
  if os.environ.get('FAKE_FAIL')=='build': code=1
 elif command=='up':
  config=pathlib.Path(a[a.index('-f')+1]).read_text().strip()
  record('up',config=config,args=args,tags={key:value['Id'] for key,value in s['tags'].items() if key.endswith(':production')})
  if os.environ.get('FAKE_FAIL')=='up' and config=='new-compose': code=1
  elif os.environ.get('FAKE_FAIL')=='proxy-refresh' and '--no-deps' in args and config=='new-compose': code=1
  else:
   services=['web'] if '--no-deps' in args else ['akshare-bridge','backend','web']
   images=dict(zip(['akshare-bridge','backend','web'],['kairos-akshare-bridge','kairos-api','kairos-web']))
   for service in services:
    image=s['tags'][images[service]+':production']['Id']
    if image!=s['container_images'].get(service) or '--force-recreate' in args:
     s['containers'][service]='new-'+service+'-'+str(len(s['events']))
     s['container_images'][service]=image
     if service=='web': s['nginx_digest']=hashlib.sha256((pathlib.Path(a[a.index('-f')+1]).parent/'deploy/nginx.conf').read_bytes()).hexdigest()
 elif command=='ps': output=s['containers'].get(args[-1],'')
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
        (self.root / "deploy").mkdir()
        (self.root / "deploy/nginx.conf").write_text("proxy-config-v1")
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
        self.statefile.write_text(json.dumps(dict(tags=tags, events=[],
            containers={key: "old-" + key for key in ("akshare-bridge", "backend", "web")},
            container_images=dict(zip(("akshare-bridge", "backend", "web"), ("old-kairos-akshare-bridge", "old-kairos-api", "old-kairos-web"))),
            nginx_digest=hashlib.sha256(b"proxy-config-v1").hexdigest())))
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
        (new / "deploy/nginx.conf").write_text("proxy-config-v1")
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

    def test_backend_replacement_refreshes_retained_proxy_and_preserves_bridge(self):
        result, state = self.run_deployment()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotEqual(state["containers"]["web"], "old-web")
        self.assertEqual(state["containers"]["akshare-bridge"], "old-akshare-bridge")
        refreshes = [event for event in state["events"] if event["kind"] == "up" and "--no-deps" in event["args"]]
        self.assertEqual(len(refreshes), 1)

    def test_metadata_only_release_preserves_all_containers(self):
        result, state = self.run_deployment("metadata-only")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(state["containers"], {key: "old-" + key for key in ("akshare-bridge", "backend", "web")})

    def test_mounted_proxy_configuration_change_refreshes_web(self):
        (self.release / "deploy/nginx.conf").write_text("proxy-config-v2")
        self.write_archive()
        result, state = self.run_deployment("metadata-only")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotEqual(state["containers"]["web"], "old-web")
        self.assertEqual(state["containers"]["backend"], "old-backend")
        self.assertEqual(state["nginx_digest"], hashlib.sha256(b"proxy-config-v2").hexdigest())

    def test_failed_proxy_refresh_restores_matching_old_release(self):
        self.assert_failed_flow("proxy-refresh")

    def enable_retention(self):
        for name in ("release_retention.py", "image_runtime_fingerprint.py"):
            for target in (self.root / "deploy" / name, self.release / "deploy" / name):
                shutil.copyfile(REPOSITORY / "deploy" / name, target)
        state = json.loads(self.statefile.read_text())
        for image in state["tags"].values():
            image["Id"] = "sha256:" + hashlib.sha256(image["Id"].encode()).hexdigest()
        for service, name in zip(("akshare-bridge", "backend", "web"), ("kairos-akshare-bridge", "kairos-api", "kairos-web")):
            state["container_images"][service] = state["tags"][name + ":production"]["Id"]
        self.statefile.write_text(json.dumps(state))
        self.env["FAKE_REAL_IDS"] = "1"
        self.write_archive()

    def test_success_keeps_previous_source_and_three_matching_image_tags(self):
        self.enable_retention()
        result, state = self.run_deployment()
        self.assertEqual(result.returncode, 0, result.stderr)
        index = json.loads((self.root / "runtime/releases/index.json").read_text())
        self.assertEqual(index["current"]["commit"], COMMIT)
        source = self.root / "runtime/releases" / index["previous"] / "source.tar.gz"
        with tarfile.open(source) as archive:
            self.assertEqual(archive.extractfile("old-source.txt").read(), b"old source")
            self.assertNotIn(".env.production", archive.getnames())
        self.assertEqual(len([tag for tag in state["tags"] if ":retained-" in tag]), 3)
        self.assertFalse(any(event["kind"] == "host-prune" for event in state["events"]))

    def test_failed_build_preserves_old_source_and_does_not_publish_retention_pointer(self):
        self.enable_retention()
        result, state = self.run_deployment("build")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.root / "old-source.txt").read_text(), "old source")
        self.assertFalse((self.root / "runtime/releases/index.json").exists())
        self.assertFalse(any(":retained-" in tag for tag in state["tags"]))

    def test_repeat_deployment_keeps_original_previous_slot(self):
        self.enable_retention()
        result, _ = self.run_deployment()
        self.assertEqual(result.returncode, 0, result.stderr)
        first = json.loads((self.root / "runtime/releases/index.json").read_text())["previous"]
        self.write_archive()
        result, state = self.run_deployment()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads((self.root / "runtime/releases/index.json").read_text())["previous"], first)
        self.assertEqual(len([tag for tag in state["tags"] if ":retained-" in tag]), 3)

    def test_missing_or_mismatched_healthy_images_stop_before_source_replacement(self):
        self.enable_retention()
        state = json.loads(self.statefile.read_text()); state["container_images"]["backend"] = "sha256:" + "f" * 64
        self.statefile.write_text(json.dumps(state))
        result, _ = self.run_deployment()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("current source is preserved", result.stderr)
        self.assertEqual((self.root / "old-source.txt").read_text(), "old source")

    def test_target_archive_without_retention_helper_can_still_complete_with_copied_tool(self):
        self.enable_retention()
        (self.release / "deploy/release_retention.py").unlink()
        (self.release / "deploy/image_runtime_fingerprint.py").unlink()
        self.write_archive()
        result, state = self.run_deployment()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.root / "runtime/releases/index.json").exists())
        self.assertEqual(len([tag for tag in state["tags"] if ":retained-" in tag]), 3)

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
