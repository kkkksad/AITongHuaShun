"""Read-only disk gate before a production release changes source or containers."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys


MIN_FREE_BYTES = 4 * 1024 ** 3


def docker_storage_root():
    value = subprocess.check_output(
        ["docker", "info", "--format", "{{.DockerRootDir}}"],
        text=True, stderr=subprocess.PIPE, timeout=15,
    ).strip()
    path = Path(value)
    if not value or "\n" in value or "\r" in value or not path.is_absolute() or not path.is_dir():
        raise ValueError("Cannot determine an accessible absolute Docker storage directory")
    return path


def check_capacity(root):
    root = Path(root)
    if not root.is_absolute() or not root.is_dir():
        raise ValueError("An existing absolute application directory is required")
    docker_root = docker_storage_root()
    filesystems = []
    for name, path in (("application", root), ("docker", docker_root)):
        usage = shutil.disk_usage(path)
        filesystems.append(dict(name=name, path=str(path), freeBytes=usage.free, totalBytes=usage.total))
        if usage.free < MIN_FREE_BYTES:
            raise ValueError(f"Insufficient deployment space on {name}: {usage.free} bytes available; "
                             f"at least {MIN_FREE_BYTES} bytes required. Current source and services are preserved.")
    # Paths may refer to the same filesystem. Never add their free-space figures.
    return dict(ok=True, minimumFreeBytes=MIN_FREE_BYTES, filesystems=filesystems)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("/opt/kairos"))
    args = parser.parse_args()
    try:
        print(json.dumps(check_capacity(args.root), sort_keys=True))
        return 0
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"Deployment capacity check failed: {error}", file=sys.stderr)
        return 75


if __name__ == "__main__":
    raise SystemExit(main())
