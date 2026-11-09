"""Single-host release assets. Call mutations under the production deployment lock.

This is source/image retention, not an account, secret or disaster-recovery backup.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tarfile
import uuid

from image_runtime_fingerprint import runtime_fingerprint

IMAGES = ("kairos-akshare-bridge", "kairos-api", "kairos-web")
SERVICES = ("akshare-bridge", "backend", "web")
SLOT = re.compile(r"release-[0-9a-f]{16}\Z")
SHA = re.compile(r"[0-9a-f]{40}\Z")
IMAGE_ID = re.compile(r"sha256:[0-9a-f]{64}\Z")
DIGEST = re.compile(r"[0-9a-f]{64}\Z")


def docker(*args):
    result = subprocess.run(["docker", *map(str, args)], check=True, text=True, capture_output=True)
    if args[:2] == ("image", "inspect") or args[:1] == ("inspect",):
        return json.loads(result.stdout)
    return result.stdout.strip()


def plain_file(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError("Expected a regular retained-release file")
    return path


def home(root, create=False):
    root = Path(root).absolute()
    runtime = root / "runtime"
    target = runtime / "releases"
    for path in (root, runtime, target):
        if path.is_symlink() or path.exists() and not path.is_dir():
            raise ValueError("Retained-release directory is unsafe")
    if not root.is_dir() or not runtime.is_dir():
        raise ValueError("Application and runtime directories must already exist")
    if create: target.mkdir(mode=0o700, exist_ok=True)
    return target


def slot_path(root, slot):
    if not isinstance(slot, str) or not SLOT.fullmatch(slot):
        raise ValueError("Invalid retained-release slot")
    target = home(root) / slot
    if target.is_symlink() or target.exists() and not target.is_dir():
        raise ValueError("Retained-release slot is unsafe")
    return target


def sha256_file(path):
    digest = hashlib.sha256()
    with plain_file(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def atomic_json(path, value):
    if path.is_symlink(): raise ValueError("Refusing symlink metadata")
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with temporary.open("x", encoding="utf8") as stream:
            os.chmod(temporary, 0o600)
            json.dump(value, stream, sort_keys=True)
            stream.write("\n")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def inventory(root):
    """Stable source identity; never traverse runtime, Git or private env files."""
    root = Path(root)
    result = []
    total = 0
    for directory, dirs, files in os.walk(root, followlinks=False):
        relative = Path(directory).relative_to(root)
        dirs[:] = sorted(name for name in dirs if not name.startswith(".env") and name not in (".git", "__pycache__", ".pytest_cache") and
                         not (relative == Path(".") and name == "runtime"))
        for name in dirs:
            if (Path(directory) / name).is_symlink(): raise ValueError("Source directory symlink is unsupported")
        for name in sorted(files):
            if name == ".git" or name.endswith((".pyc", ".pyo")) or name.startswith(".env") and name != ".env.example": continue
            path = plain_file(Path(directory) / name)
            info = path.stat()
            total += info.st_size
            if total > 128 * 1024 * 1024 or len(result) >= 10000:
                raise ValueError("Source inventory exceeds retention limits")
            result.append(dict(path=path.relative_to(root).as_posix(), size=info.st_size,
                               mode=stat.S_IMODE(info.st_mode), sha256=sha256_file(path)))
    result.sort(key=lambda item: item["path"])
    if not result: raise ValueError("Cannot retain an empty application source")
    digest = hashlib.sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()
    return result, digest


def production_images(root, require_healthy=False):
    result = []
    for service, name in zip(SERVICES, IMAGES):
        inspected = docker("image", "inspect", name + ":production")
        if not isinstance(inspected, list) or len(inspected) != 1:
            raise ValueError("Ambiguous production image")
        data = inspected[0]
        if not IMAGE_ID.fullmatch(str(data.get("Id", ""))): raise ValueError("Invalid Docker image identity")
        if require_healthy:
            cid = docker("compose", "--env-file", str(root / ".env.production"), "-f",
                         str(root / "docker-compose.production.yml"), "ps", "-q", service)
            if not cid or "\n" in cid: raise ValueError("Missing or ambiguous running service")
            containers = docker("inspect", cid)
            if len(containers) != 1 or containers[0].get("Image") != data["Id"] or \
                    containers[0].get("State", {}).get("Health", {}).get("Status") != "healthy":
                raise ValueError("Production source snapshot requires matching healthy image tags")
        result.append(dict(name=name, imageId=data["Id"], runtimeFingerprint=runtime_fingerprint(inspected)))
    return result


def read_index(root):
    file = home(root) / "index.json"
    if not file.exists():
        if file.is_symlink(): raise ValueError("Unsafe retention index")
        return None
    data = json.loads(plain_file(file).read_text())
    current = data.get("current", {})
    if data.get("version") != 1 or not SLOT.fullmatch(str(data.get("previous", ""))) or \
            not SHA.fullmatch(str(current.get("commit", ""))) or not DIGEST.fullmatch(str(current.get("sourceDigest", ""))) or \
            not isinstance(current.get("images"), list) or len(current["images"]) != len(IMAGES):
        raise ValueError("Invalid retained-release index")
    for image, name in zip(current["images"], IMAGES):
        if not isinstance(image, dict) or image.get("name") != name or \
                not IMAGE_ID.fullmatch(str(image.get("imageId", ""))) or \
                not DIGEST.fullmatch(str(image.get("runtimeFingerprint", ""))):
            raise ValueError("Invalid current release image record")
    return data


def manifest(root, slot):
    folder = slot_path(root, slot)
    data = json.loads(plain_file(folder / "manifest.json").read_text())
    if data.get("version") != 1 or data.get("slot") != slot or not DIGEST.fullmatch(str(data.get("archiveSha256", ""))) or \
            not SHA.fullmatch(str(data.get("incomingCommit", ""))) or \
            not DIGEST.fullmatch(str(data.get("sourceDigest", ""))) or \
            data.get("commit") is not None and not SHA.fullmatch(str(data["commit"])):
        raise ValueError("Invalid retained-release manifest")
    images = data.get("images")
    if not isinstance(images, list) or len(images) != len(IMAGES): raise ValueError("Incomplete retained image set")
    for image, name in zip(images, IMAGES):
        if image.get("name") != name or image.get("tag") != name + ":retained-" + slot or \
                not IMAGE_ID.fullmatch(str(image.get("imageId", ""))) or \
                not DIGEST.fullmatch(str(image.get("runtimeFingerprint", ""))):
            raise ValueError("Invalid retained image reference")
    return data


def verify_slot(root, slot):
    data = manifest(root, slot)
    archive = slot_path(root, slot) / "source.tar.gz"
    if sha256_file(archive) != data["archiveSha256"]: raise ValueError("Retained archive checksum mismatch")
    for image in data["images"]:
        inspected = docker("image", "inspect", image["tag"])
        if len(inspected) != 1 or inspected[0].get("Id") != image["imageId"] or \
                runtime_fingerprint(inspected) != image["runtimeFingerprint"]:
            raise ValueError("Retained image no longer matches its source snapshot")
    return data


def stage(root, incoming):
    if not SHA.fullmatch(incoming): raise ValueError("A full commit SHA is required")
    root = Path(root).absolute()
    target = home(root, create=True)
    prior = read_index(root)
    files, digest = inventory(root)
    images = production_images(root, require_healthy=True)
    same_current = prior and prior["current"]["sourceDigest"] == digest and prior["current"]["images"] == images
    if same_current and prior["current"]["commit"] == incoming:
        verify_slot(root, prior["previous"])
        return "unchanged"
    if sum(1 for item in target.iterdir() if SLOT.fullmatch(item.name)) >= 4:
        raise ValueError("Retained-release slots need review before another deployment")
    slot = "release-" + uuid.uuid4().hex[:16]
    folder = slot_path(root, slot)
    folder.mkdir(mode=0o700)
    tags = []
    try:
        archive = folder / "source.tar.gz"
        with tarfile.open(archive, "w:gz") as output:
            for item in files: output.add(root / item["path"], arcname=item["path"], recursive=False)
        os.chmod(archive, 0o600)
        # Ensure no source changed during capture; deployment lock does not cover manual edits.
        if inventory(root)[1] != digest: raise ValueError("Application source changed during retention")
        for image in images:
            image["tag"] = image["name"] + ":retained-" + slot
            docker("image", "tag", image["imageId"], image["tag"])
            tags.append(image["tag"])
        value = dict(version=1, slot=slot, incomingCommit=incoming, commit=prior["current"]["commit"] if same_current else None,
                     createdAt=datetime.now(timezone.utc).isoformat(), sourceDigest=digest,
                     archiveSha256=sha256_file(archive), images=images)
        atomic_json(folder / "manifest.json", value)
        verify_slot(root, slot)
        return slot
    except Exception:
        for tag in tags:
            try: docker("image", "rm", tag)
            except Exception: pass
        for name in ("source.tar.gz", "manifest.json"):
            (folder / name).unlink(missing_ok=True)
        folder.rmdir()
        raise


def remove_slot(root, slot):
    data = manifest(root, slot)  # Validate all references before any Docker removal.
    folder = slot_path(root, slot)
    plain_file(folder / "source.tar.gz")
    plain_file(folder / "manifest.json")
    for image in data["images"]: docker("image", "rm", image["tag"])
    # Only these two owned files are removed; unexpected contents are preserved.
    plain_file(folder / "source.tar.gz").unlink()
    plain_file(folder / "manifest.json").unlink()
    folder.rmdir()


def abort(root, slot):
    if slot == "unchanged": return
    folder = slot_path(root, slot)
    index = read_index(root)
    if index and index["previous"] == slot: return  # A committed slot cannot be aborted.
    if folder.exists(): remove_slot(root, slot)


def promote(root, slot, incoming):
    if not SHA.fullmatch(incoming): raise ValueError("A full commit SHA is required")
    root = Path(root).absolute()
    previous = read_index(root)
    if slot == "unchanged":
        if not previous or previous["current"]["commit"] != incoming: raise ValueError("No identical release to preserve")
        verify_slot(root, previous["previous"])
        slot = previous["previous"]
    else:
        if verify_slot(root, slot)["incomingCommit"] != incoming:
            raise ValueError("Staged assets belong to a different incoming release")
    current = dict(commit=incoming, sourceDigest=inventory(root)[1], images=production_images(root, require_healthy=True))
    atomic_json(home(root) / "index.json", dict(version=1, previous=slot, current=current))
    if previous and previous["previous"] != slot:
        try: remove_slot(root, previous["previous"])
        except Exception:
            # The verified replacement is already committed. Cleanup cannot undo a healthy release.
            print("Previous assets retained; older slot cleanup needs attention.", file=__import__("sys").stderr)


def verify(root):
    index = read_index(root)
    if not index: raise ValueError("No retained previous release is installed yet")
    return dict(current=index["current"], previous=verify_slot(root, index["previous"]))


def export_previous(root, target):
    data = verify(root)
    source = slot_path(root, data["previous"]["slot"]) / "source.tar.gz"
    with Path(target).open("xb") as output:
        os.chmod(target, 0o600)
        with source.open("rb") as input_stream: shutil.copyfileobj(input_stream, output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("stage", "promote", "abort", "verify", "export"))
    parser.add_argument("--root", type=Path, default=Path("/opt/kairos"))
    parser.add_argument("--commit")
    parser.add_argument("--slot")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.action == "stage": print(stage(args.root, args.commit or ""))
    elif args.action == "promote": promote(args.root, args.slot, args.commit or "")
    elif args.action == "abort": abort(args.root, args.slot)
    elif args.action == "verify": print(json.dumps(verify(args.root)))
    elif args.action == "export":
        if args.output is None: parser.error("export requires --output")
        export_previous(args.root, args.output)


if __name__ == "__main__": main()
