"""Hash Docker runtime content without volatile image-index proof metadata."""
import hashlib
import json
import sys


def runtime_fingerprint(images):
    if not isinstance(images, list) or len(images) != 1 or not isinstance(images[0], dict):
        raise ValueError("one inspected image is required")
    image = images[0]
    if not isinstance(image.get("Config"), dict) or not isinstance(image.get("RootFS"), dict):
        raise ValueError("runtime configuration and layers are required")
    layers = image["RootFS"].get("Layers")
    if image["RootFS"].get("Type") != "layers" or not isinstance(layers, list) or any(not isinstance(layer, str) or not layer for layer in layers):
        raise ValueError("ordered runtime layers are required")
    if not isinstance(image.get("Os"), str) or not image["Os"] or not isinstance(image.get("Architecture"), str) or not image["Architecture"]:
        raise ValueError("runtime platform is required")
    selected = {key: image.get(key) for key in
                ("Config", "RootFS", "Os", "Architecture", "Variant", "OsVersion", "OsFeatures")}
    payload = json.dumps(selected, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(payload.encode()).hexdigest()


def main():
    try:
        body = sys.stdin.buffer.read(1024 * 1024 + 1)
        if len(body) > 1024 * 1024:
            raise ValueError("inspect input is too large")
        print(runtime_fingerprint(json.loads(body)))
        return 0
    except (ValueError, TypeError, OverflowError):
        print("Could not determine image runtime fingerprint.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
