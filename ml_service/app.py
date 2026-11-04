"""
DataScoop - ML Service (Flask, port 5001)

Classifies a 2D brain MRI slice into 4 classes with the CNN models that were
actually measured (see eval/model_metrics.json and eval/RESULTS.md).

Honesty rules enforced in this file:
  1. NO simulated / random predictions, ever. A model that is missing, disabled
     or crashes is EXCLUDED from the answer and reported in `excluded_models`.
  2. If no model can answer, the service returns HTTP 503 ("analysis unavailable")
     instead of inventing a diagnosis.
  3. Every accuracy figure shown to users is READ from eval/model_metrics.json,
     which is produced from the Kaggle evaluation run. Nothing is typed by hand.

Research prototype - NOT a medical device. Never use it for clinical decisions.
"""

from __future__ import annotations  # allows `str | None` hints on Python 3.9

import io
import json
import os
import time

import numpy as np
from flask import Flask, jsonify, request
from PIL import Image, UnidentifiedImageError

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.environ.get("DATASCOOP_MODELS_DIR", os.path.join(BASE_DIR, "models"))
METRICS_PATH = os.environ.get("DATASCOOP_METRICS_PATH", os.path.join(BASE_DIR, "eval", "model_metrics.json"))

# Class order = alphabetical folder order used by Keras flow_from_directory during training
# (verified in the training notebook: {'MildDemented':0,'ModerateDemented':1,'NonDemented':2,'VeryMildDemented':3}).
CLASSES = ["Mild Demented", "Moderate Demented", "Non Demented", "Very Mild Demented"]

DISCLAIMER = (
    "Prototype de recherche, pas un dispositif médical. Résultat indicatif sur une coupe IRM 2D : "
    "il ne remplace pas l'avis d'un neurologue."
)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # reject uploads > 10 MB (HTTP 413)
# No CORS here on purpose: only the Node backend calls this service (server-to-server),
# browsers must never call it directly.

loaded_models: dict = {}     # name -> Keras model actually in memory
excluded_models: dict = {}   # name -> human-readable reason why it is not used
model_metrics: dict = {}     # name -> measured metrics + config from eval/model_metrics.json


def load_metrics(path: str = METRICS_PATH) -> dict:
    """Read the measured metrics file. Missing file -> no model is trusted -> nothing is loaded."""
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh).get("models", {})


def load_all_models() -> None:
    """Load only the models marked `enabled` in the metrics file; record why the others are excluded."""
    model_metrics.clear()
    model_metrics.update(load_metrics())
    if not model_metrics:
        excluded_models["*"] = f"metrics file not found: {METRICS_PATH}"
        return

    try:
        import tensorflow as tf  # imported lazily so tests can run without TensorFlow
        from tensorflow.keras.layers import Dense
    except ImportError:
        for name in model_metrics:
            excluded_models[name] = "TensorFlow is not installed"
        return

    class CompatibleDense(Dense):
        """Drops `quantization_config`, written by newer Keras versions, so older ones can load the file."""

        @classmethod
        def from_config(cls, config):
            config = dict(config)
            config.pop("quantization_config", None)
            return super().from_config(config)

    print("TensorFlow version:", tf.__version__)
    for name, cfg in model_metrics.items():
        if not cfg.get("enabled", False):
            excluded_models[name] = cfg.get("disabled_reason", "disabled in model_metrics.json")
            continue
        path = os.path.join(MODELS_DIR, cfg["file"])
        if not os.path.exists(path):
            excluded_models[name] = f"model file not found: {cfg['file']} (run `git lfs pull`)"
            continue
        if os.path.getsize(path) < 1024:  # a ~130-byte Git LFS pointer is not a model
            excluded_models[name] = f"{cfg['file']} is a Git LFS pointer, not the model (run `git lfs pull`)"
            continue
        try:
            loaded_models[name] = tf.keras.models.load_model(
                path, compile=False, custom_objects={"Dense": CompatibleDense}
            )
            print(f"  OK  {name} <- {cfg['file']}")
        except Exception as exc:  # noqa: BLE001 - any loading problem excludes the model
            excluded_models[name] = f"failed to load: {type(exc).__name__}: {exc}"
            print(f"  EXCLUDED {name}: {excluded_models[name]}")


def check_input(image_bytes: bytes) -> str | None:
    """
    BASIC sanity check, NOT real out-of-distribution detection. The training slices are grayscale,
    skull on a black background, at least ~128 px. Rejects the obvious misuses seen in testing
    (colour photos/screenshots, figures on a white page, thumbnails). Returns a reason, or None if OK.
    Thresholds are deliberately loose so that real dataset images always pass.
    """
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    if min(img.size) < 64:
        return f"Image trop petite ({img.size[0]}x{img.size[1]} px) : une coupe IRM d'au moins 64 px est attendue."
    arr = np.asarray(img, dtype=np.float32)
    chroma = float((arr.max(axis=2) - arr.min(axis=2)).mean())          # 0 for a pure grayscale image
    if chroma > 25:
        return "Image en couleur : une coupe IRM en niveaux de gris est attendue (pas une photo ni une capture d'écran)."
    gray = arr.mean(axis=2)
    b = max(2, int(0.04 * min(gray.shape)))                              # 4% border strip
    border = np.concatenate([gray[:b].ravel(), gray[-b:].ravel(), gray[:, :b].ravel(), gray[:, -b:].ravel()])
    if float(border.mean()) > 100:
        return "Fond clair détecté : une coupe IRM sur fond noir est attendue (pas une figure ni un document)."
    return None


def preprocess_image(image_bytes: bytes, cfg: dict) -> np.ndarray:
    """RGB + LANCZOS resize (exactly what the Kaggle evaluation measured), then the model's own scaling."""
    size = tuple(cfg["input_size"])
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB").resize(size, Image.LANCZOS)
    arr = np.asarray(img, dtype=np.float32)
    if cfg.get("preprocess", "div255") == "div255":  # training used ImageDataGenerator(rescale=1/255)
        arr = arr / 255.0
    return np.expand_dims(arr, axis=0)  # shape (1, H, W, 3)


def run_model(name: str, image_bytes: bytes) -> dict:
    """Run ONE real model. Raises on failure; the caller decides to exclude it."""
    cfg = model_metrics[name]
    t0 = time.time()
    probs = np.asarray(loaded_models[name].predict(preprocess_image(image_bytes, cfg), verbose=0)[0], dtype=float)
    if probs.shape != (len(CLASSES),) or not np.all(np.isfinite(probs)):
        raise ValueError(f"unexpected model output shape/values: {probs.shape}")
    prob_dict = {cls: round(float(p), 4) for cls, p in zip(CLASSES, probs)}
    best_class = max(prob_dict, key=prob_dict.get)
    return {
        "prediction": best_class,
        "confidence": prob_dict[best_class],
        "probabilities": prob_dict,
        "inference_time_ms": round((time.time() - t0) * 1000),
        "mode": "real",
        "description": cfg.get("description", ""),
        # Measured on the leak-free validation subset (see eval/RESULTS.md) - never typed by hand
        "benchmark_accuracy": cfg.get("clean_accuracy"),
        "benchmark_macro_f1": cfg.get("clean_macro_f1"),
        "benchmark_accuracy_ci95": cfg.get("clean_accuracy_ci95"),
    }


def rank_models(names: list[str]) -> list[str]:
    """
    FIXED ranking by measured macro-F1 on the leak-free subset.
    Why not per-image confidence x accuracy (the old "reliability score")? Softmax confidence is not
    calibrated, so picking the most confident model per image rewards over-confidence.
    """
    return sorted(names, key=lambda n: model_metrics[n].get("clean_macro_f1") or 0.0, reverse=True)


@app.route("/health", methods=["GET"])
def health():
    status = "ok" if loaded_models else "unavailable"
    body = {"status": status, "loaded_models": sorted(loaded_models), "excluded_models": excluded_models}
    return jsonify(body), (200 if loaded_models else 503)


@app.route("/predict", methods=["POST"])
def predict():
    # 1) Input validation -> 400 (client error)
    file = request.files.get("file")
    if file is None or file.filename == "":
        return jsonify({"error": "Aucun fichier fourni (champ 'file')."}), 400
    image_bytes = file.read()
    try:
        Image.open(io.BytesIO(image_bytes)).verify()  # cheap integrity check, does not decode pixels
    except (UnidentifiedImageError, OSError, SyntaxError):
        return jsonify({"error": "Format image invalide."}), 400

    # 1b) Obvious non-MRI inputs -> 422 with the reason (the classifier would otherwise answer anyway)
    reason = check_input(image_bytes)
    if reason:
        return jsonify({"error": reason}), 422

    # 2) No model available -> 503, never an invented diagnosis
    if not loaded_models:
        return jsonify({
            "error": "Analyse indisponible : aucun modèle validé n'est chargé.",
            "excluded_models": excluded_models,
        }), 503

    # 3) Run every loaded model; a crashing model is excluded from THIS answer and reported
    results, failed = {}, {}
    for name in loaded_models:
        try:
            results[name] = run_model(name, image_bytes)
        except Exception as exc:  # noqa: BLE001
            failed[name] = f"inference failed: {type(exc).__name__}: {exc}"
            app.logger.warning("model %s failed: %s", name, failed[name])

    if not results:
        return jsonify({"error": "Analyse indisponible : tous les modèles ont échoué.",
                        "excluded_models": {**excluded_models, **failed}}), 503

    ranked = rank_models(list(results))
    best_name = ranked[0]
    best = results[best_name]
    total_ms = sum(r["inference_time_ms"] for r in results.values())
    f1 = model_metrics[best_name].get("clean_macro_f1")
    return jsonify({
        "prediction": best["prediction"],
        "confidence": best["confidence"],
        "probabilities": best["probabilities"],
        "best_model": best_name,
        "explanation": (
            f"Verdict du modèle principal '{best_name}' (choisi à l'avance : meilleur macro-F1 mesuré "
            f"{f1 if f1 is not None else 'n/a'} sur un sous-ensemble de validation sans fuite). "
            f"Les autres modèles sont affichés pour comparaison. {DISCLAIMER}"
        ),
        "all_models": results,
        "ranked_models": ranked,
        "excluded_models": {**excluded_models, **failed},
        "total_models": len(results),
        "total_time_ms": total_ms,
        "disclaimer": DISCLAIMER,
    })


@app.errorhandler(413)
def too_large(_err):
    return jsonify({"error": "Fichier trop volumineux (max 10 Mo)."}), 413


if __name__ == "__main__":
    print("\nDataScoop - ML service starting")
    load_all_models()
    print("Loaded:", sorted(loaded_models) or "NONE", "| Excluded:", excluded_models)
    host = os.environ.get("ML_HOST", "127.0.0.1")  # localhost only by default: the backend is the only client
    app.run(host=host, port=int(os.environ.get("ML_PORT", 5001)), debug=False, threaded=True)
