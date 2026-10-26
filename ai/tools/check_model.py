"""Inspect the supplied checkpoint; optional synthetic inference checks plumbing only."""
import argparse
import importlib.metadata
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.diagnosis.classifier import Classifier  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--smoke", action="store_true", help="Run one uniform RGB image; never writes history or measures accuracy")
    args = parser.parse_args()
    runner = Classifier(ROOT / "models/disease/best.pt", "cpu")
    result = runner.describe()
    result["imgsz"] = getattr(runner.model, "overrides", {}).get("imgsz")
    result["versions"] = {name: importlib.metadata.version(name) for name in ("ultralytics", "torch", "torchvision")}
    if args.smoke:
        from PIL import Image
        result["synthetic_smoke_not_accuracy"] = runner.predict(Image.new("RGB", (224, 224), "green"))
    print(json.dumps(result, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
