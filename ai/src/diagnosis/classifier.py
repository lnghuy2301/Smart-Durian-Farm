import hashlib
import math
import os
import threading
from pathlib import Path


class Classifier:
    """One lazy model instance. An absent file must never trigger a download."""

    def __init__(self, model_path: Path, device: str = "cpu", loader=None):
        self.path = model_path
        self.device = device
        self.loader = loader
        self.model = None
        self.sha256 = None
        self.lock = threading.Lock()

    def _load(self):
        if self.model is not None:
            return
        loader = self.loader
        if loader is None:
            # Local inference must not probe the Internet, sync usage, or write into
            # the user's global profile. These settings precede the first import.
            os.environ["YOLO_OFFLINE"] = "true"
            os.environ["YOLO_AUTOINSTALL"] = "false"
            os.environ["YOLO_CONFIG_DIR"] = str(Path(__file__).resolve().parents[2] / ".runtime")
            from ultralytics import YOLO
            from ultralytics import settings
            settings.update({"sync": False})
            loader = YOLO
        with self.path.open("rb") as source:
            before = hashlib.file_digest(source, "sha256").hexdigest()
        model = loader(str(self.path))
        if model.task != "classify":
            raise RuntimeError("classification_model_required")
        with self.path.open("rb") as source:
            after = hashlib.file_digest(source, "sha256").hexdigest()
        if before != after:
            raise RuntimeError("model_changed_during_load")
        self.sha256 = after
        self.model = model

    def describe(self):
        """Load once to verify dependencies/task; file presence alone is not readiness."""
        if not self.path.is_file() or not self.lock.acquire(blocking=False):
            raise RuntimeError("model_not_ready_or_busy")
        try:
            self._load()
            names = self.model.names
            if not isinstance(names, dict) or not names or len(names) > 1000:
                raise RuntimeError("invalid_class_names")
            classes = []
            for index in sorted(names):
                label = names[index]
                if not isinstance(index, int) or index < 0 or not isinstance(label, str) or not label.strip() or len(label) > 200:
                    raise RuntimeError("invalid_class_names")
                classes.append({"class_id": index, "label": label})
            return {"task": "classify", "model_sha256": self.sha256, "classes": classes}
        finally:
            self.lock.release()

    def predict(self, image):
        if not self.path.is_file():
            raise RuntimeError("model_not_ready")
        if not self.lock.acquire(blocking=False):
            raise RuntimeError("model_busy")
        try:
            self._load()
            result = self.model.predict(source=image, device=self.device, verbose=False, save=False)[0]
            if result.probs is None:
                raise RuntimeError("invalid_classification_result")
            values = result.probs.data.cpu().tolist()
            if not values or len(values) > 1000 or any(not math.isfinite(v) or v < 0 or v > 1 for v in values):
                raise RuntimeError("invalid_classification_scores")
            if abs(sum(values) - 1) > 0.01:
                raise RuntimeError("invalid_classification_scores")
            top = sorted(range(len(values)), key=lambda i: values[i], reverse=True)[:3]
            predictions = []
            for i in top:
                label = self.model.names[i]
                if not isinstance(label, str) or not label.strip() or len(label) > 200:
                    raise RuntimeError("invalid_class_label")
                predictions.append({"class_id": i, "label": label, "confidence": values[i]})
            return {"task": "classify", "model_sha256": self.sha256, "predictions": predictions}
        finally:
            self.lock.release()
