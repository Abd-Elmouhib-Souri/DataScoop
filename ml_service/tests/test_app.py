"""
Tests for the honesty guarantees of the ML service (run from ml_service/:  python -m pytest -q).
They use FAKE models, so they need neither TensorFlow nor the 435 MB of .h5 files.
"""
import io
import json
import os
import sys

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # import ml_service/app.py
import app as ml  # noqa: E402
from eval.summarize_results import summarize  # noqa: E402


class FakeModel:
    """Mimics a Keras model: .predict(x) returns a (1, 4) probability array."""

    def __init__(self, probs=None, crash=False):
        self.probs, self.crash, self.last_input = probs, crash, None

    def predict(self, x, verbose=0):
        self.last_input = x
        if self.crash:
            raise RuntimeError("GPU exploded")
        return np.array([self.probs])


def png_bytes(color=(120, 120, 120)):
    buf = io.BytesIO()
    Image.new("RGB", (50, 60), color).save(buf, format="PNG")
    return buf.getvalue()


def post_image(client, data=None, name="mri.png"):
    data = png_bytes() if data is None else data
    return client.post("/predict", data={"file": (io.BytesIO(data), name)}, content_type="multipart/form-data")


@pytest.fixture
def client():
    # Reset module-level state before every test (no leakage between tests)
    ml.loaded_models.clear(); ml.excluded_models.clear(); ml.model_metrics.clear()
    ml.model_metrics.update({
        "ResNet50": {"enabled": True, "input_size": [224, 224], "preprocess": "div255", "clean_macro_f1": 0.832,
                     "clean_accuracy": 0.814, "clean_accuracy_ci95": [0.8, 0.826], "description": "resnet"},
        "CustomCNN": {"enabled": True, "input_size": [224, 224], "preprocess": "div255", "clean_macro_f1": 0.809,
                      "clean_accuracy": 0.784, "clean_accuracy_ci95": [0.77, 0.799], "description": "cnn"},
    })
    ml.app.config["TESTING"] = True
    return ml.app.test_client()


# ---------- 1. Never invent a diagnosis ----------

def test_simulation_code_is_gone():
    assert not hasattr(ml, "simulate_prediction")


def test_no_model_loaded_returns_503_without_prediction(client):
    r = post_image(client)
    assert r.status_code == 503
    body = r.get_json()
    assert "prediction" not in body and "probabilities" not in body   # nothing invented


def test_health_is_503_when_no_model(client):
    r = client.get("/health")
    assert r.status_code == 503 and r.get_json()["status"] == "unavailable"


def test_all_models_crash_returns_503(client):
    ml.loaded_models.update({"ResNet50": FakeModel(crash=True), "CustomCNN": FakeModel(crash=True)})
    r = post_image(client)
    assert r.status_code == 503
    assert "prediction" not in r.get_json()
    assert set(r.get_json()["excluded_models"]) == {"ResNet50", "CustomCNN"}


def test_crashing_model_is_excluded_not_simulated(client):
    ml.loaded_models.update({"ResNet50": FakeModel(crash=True), "CustomCNN": FakeModel([0.1, 0.1, 0.7, 0.1])})
    body = post_image(client).get_json()
    assert set(body["all_models"]) == {"CustomCNN"}            # only the model that really answered
    assert "ResNet50" in body["excluded_models"]
    assert body["best_model"] == "CustomCNN"


# ---------- 2. Input validation ----------

def test_missing_file_is_400(client):
    assert client.post("/predict", data={}, content_type="multipart/form-data").status_code == 400


def test_non_image_is_400(client):
    ml.loaded_models["ResNet50"] = FakeModel([0.25] * 4)
    assert post_image(client, data=b"this is not an image").status_code == 400


# ---------- 3. Real path ----------

def test_real_prediction_uses_fixed_ranking_not_confidence(client):
    # CustomCNN is MORE confident, but ResNet50 has the better measured macro-F1 -> ResNet50 decides
    ml.loaded_models.update({"ResNet50": FakeModel([0.6, 0.1, 0.2, 0.1]), "CustomCNN": FakeModel([0.0, 0.0, 0.99, 0.01])})
    r = post_image(client)
    assert r.status_code == 200
    body = r.get_json()
    assert body["best_model"] == "ResNet50"
    assert body["prediction"] == "Mild Demented"               # class index 0 = alphabetical training order
    assert body["ranked_models"] == ["ResNet50", "CustomCNN"]
    assert all(m["mode"] == "real" for m in body["all_models"].values())
    assert body["all_models"]["ResNet50"]["benchmark_accuracy"] == 0.814   # measured value, from the metrics file
    assert "disclaimer" in body


def test_preprocessing_div255_and_size(client):
    fake = FakeModel([0.25] * 4)
    ml.loaded_models["ResNet50"] = fake
    post_image(client, data=png_bytes((255, 255, 255)))
    assert fake.last_input.shape == (1, 224, 224, 3)
    assert fake.last_input.max() <= 1.0                         # /255 applied (training used rescale=1/255)


# ---------- 4. Model loading & metrics generation ----------

def test_missing_metrics_file_loads_nothing(tmp_path, monkeypatch):
    ml.loaded_models.clear(); ml.excluded_models.clear()
    monkeypatch.setattr(ml, "METRICS_PATH", str(tmp_path / "nope.json"))
    monkeypatch.setattr(ml, "load_metrics", lambda path=None: {})
    ml.load_all_models()
    assert ml.loaded_models == {} and "*" in ml.excluded_models


def _fake_eval(f1, acc=0.8):
    m = {"accuracy": acc, "macro_f1": f1, "accuracy_ci95": [acc - 0.01, acc + 0.01], "ece": 0.03,
         "recall": {"MildDemented": 0.8, "ModerateDemented": 0.8, "NonDemented": 0.8, "VeryMildDemented": 0.8}}
    return {"full_val": m, "clean": m}


def test_summarize_disables_collapsed_models_and_drops_duplicate():
    results = {
        "UltraBestModel": {"div255": _fake_eval(0.83), "raw0_255": _fake_eval(0.13)},
        "EfficientNetB0": {"div255": _fake_eval(0.115), "raw0_255": _fake_eval(0.17)},
        "BestModel": {"div255": _fake_eval(0.80), "raw0_255": _fake_eval(0.6)},
        "EfficientNetB4": {"file": "x", "load_error": "ResourceExhaustedError: OOM"},
    }
    metrics, table = summarize(results)
    m = metrics["models"]
    assert m["ResNet50"]["enabled"] and m["ResNet50"]["preprocess"] == "div255"
    assert not m["EfficientNetB0"]["enabled"]                   # collapsed -> disabled
    assert not m["EfficientNetB4"]["enabled"]                   # evaluation error -> disabled
    assert "BestModel" not in m                                  # duplicate of AlzheimerCNN -> dropped
    assert "ResNet50" in table


def test_shipped_metrics_file_is_valid():
    with open(os.path.join(os.path.dirname(ml.__file__), "eval", "model_metrics.json"), encoding="utf-8") as fh:
        models = json.load(fh)["models"]
    for name, cfg in models.items():
        assert {"enabled", "file", "input_size", "preprocess"} <= set(cfg), name
        if cfg["enabled"]:
            assert cfg["clean_macro_f1"] >= 0.5, name           # never ship a collapsed model
