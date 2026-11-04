"""
Turn the Kaggle evaluation output (results.json) into:
  - eval/model_metrics.json  (read by app.py: which models are enabled + their MEASURED metrics)
  - eval/RESULTS.md          (human-readable table for the README)

Usage (from ml_service/):  python eval/summarize_results.py path/to/results.json

Decision rules (explicit, so a reviewer can check them):
  * A model is ENABLED only if its best preprocessing reaches clean macro-F1 >= MIN_MACRO_F1.
    0.5 is far above a collapsed model (~0.12, one class) and chance (0.25 accuracy); it filters
    broken models without cherry-picking.
  * A model that is not broken but CLEARLY weaker than the best one is not served either:
    its clean macro-F1 must be within MAX_GAP_TO_BEST of the best model. Rule added after run v2
    (2026-11-03), when EfficientNet-B4 passed the 0.5 gate at 0.545 vs 0.832 for ResNet50
    (non-overlapping 95% CIs): serving it would mostly produce false "models disagree" warnings.
    It is reported, not hidden.
  * For each model we keep the preprocessing ('div255' or 'raw0_255') with the higher CLEAN macro-F1.
  * 'BestModel' (best_model.h5) is dropped: identical predictions to AlzheimerCNN on all 10,079
    images (same weights + saved optimizer state) - serving both would double-count one network.
"""
from __future__ import annotations

import json
import os
import sys

MIN_MACRO_F1 = 0.5      # below: broken / collapsed model
MAX_GAP_TO_BEST = 0.10  # above this gap to the best clean macro-F1: too weak to be served

# Kaggle evaluation name -> (app name, file, input size, description, split provenance)
NAME_MAP = {
    "UltraBestModel": ("ResNet50", "ultra_best_model.h5", 224,
                       "ResNet-50 (ImageNet) + dense head, fine-tuned - training notebook5252fb6542 (split known)", "known"),
    "AlzheimerCNN": ("CustomCNN", "alzheimer_cnn_model.h5", 224,
                     "Custom 4-block CNN (training split UNKNOWN - its scores may include training images)", "unknown"),
    "EfficientNetB0": ("EfficientNetB0", "efficientnetb0_alzheimer.h5", 224, "EfficientNet-B0 (training split UNKNOWN)", "unknown"),
    "EfficientNetB3": ("EfficientNetB3", "efficientnetb3_alzheimer.h5", 300, "EfficientNet-B3 (training split UNKNOWN)", "unknown"),
    "EfficientNetB4": ("EfficientNetB4", "best_model_B4_alzheimer.h5", 380, "EfficientNet-B4 (training split UNKNOWN)", "unknown"),
}


def r3(x):
    return None if x is None else round(float(x), 3)


def best_prep(r: dict) -> str:
    """Preprocessing with the better CLEAN macro-F1 ('div255' or 'raw0_255')."""
    return max(("div255", "raw0_255"), key=lambda p: r[p]["clean"]["macro_f1"])


def summarize(results: dict) -> tuple[dict, str]:
    models, rows = {}, []
    # Best clean macro-F1 among evaluated models (reference for the MAX_GAP_TO_BEST rule)
    scores = [r[best_prep(r)]["clean"]["macro_f1"] for k, r in results.items()
              if k in NAME_MAP and "load_error" not in r]
    best_f1 = max(scores) if scores else 0.0
    for kaggle_name, (app_name, fname, size, desc, prov) in NAME_MAP.items():
        r = results.get(kaggle_name)
        base = {"file": fname, "input_size": [size, size], "description": desc, "split_provenance": prov}
        if r is None or "load_error" in r:
            reason = "not evaluated" if r is None else f"evaluation error: {r['load_error'][:200]}"
            models[app_name] = {**base, "enabled": False, "preprocess": "div255", "disabled_reason": reason}
            rows.append(f"| {app_name} | {prov} | - | - | - | - | - | disabled ({reason[:60]}) |")
            continue
        # Keep the preprocessing with the better CLEAN macro-F1
        prep = best_prep(r)
        full, clean = r[prep]["full_val"], r[prep]["clean"]
        broken = clean["macro_f1"] < MIN_MACRO_F1
        too_weak = not broken and clean["macro_f1"] < best_f1 - MAX_GAP_TO_BEST
        enabled = not broken and not too_weak
        entry = {
            **base, "enabled": enabled, "preprocess": prep,
            "full_accuracy": r3(full["accuracy"]), "full_macro_f1": r3(full["macro_f1"]),
            "clean_accuracy": r3(clean["accuracy"]),
            "clean_accuracy_ci95": [r3(v) for v in clean["accuracy_ci95"]],
            "clean_macro_f1": r3(clean["macro_f1"]),
            "clean_macro_f1_ci95": [r3(v) for v in clean["macro_f1_ci95"]],
            "clean_ece": r3(clean["ece"]),
            "clean_recall": {k: r3(v) for k, v in clean["recall"].items()},
        }
        if broken:
            entry["disabled_reason"] = f"broken: clean macro-F1 {r3(clean['macro_f1'])} < {MIN_MACRO_F1} (collapsed predictions)"
        elif too_weak:
            entry["disabled_reason"] = (f"too weak: clean macro-F1 {r3(clean['macro_f1'])} vs best {r3(best_f1)} "
                                        f"(gap > {MAX_GAP_TO_BEST}); serving it would mostly add false disagreement warnings")
        models[app_name] = entry
        rec = clean["recall"]
        rows.append(
            f"| {app_name} | {prov} | {prep} | {full['accuracy']:.3f} | "
            f"**{clean['accuracy']:.3f}** [{clean['accuracy_ci95'][0]:.3f}-{clean['accuracy_ci95'][1]:.3f}] | "
            f"{clean['macro_f1']:.3f} [{clean['macro_f1_ci95'][0]:.3f}-{clean['macro_f1_ci95'][1]:.3f}] | "
            f"{rec['MildDemented']:.2f} / {rec['ModerateDemented']:.2f} / {rec['NonDemented']:.2f} / {rec['VeryMildDemented']:.2f} | "
            f"{'enabled' if enabled else ('disabled: broken' if broken else 'disabled: too weak')} |"
        )

    md = "\n".join([
        "| Model | Training split | Preproc. | Acc. (leaky val, n=10,079) | Acc. leak-free (n=3,153) [95% CI] | Macro-F1 leak-free [95% CI] | Recall Mild / Moderate / Non / VeryMild | Status |",
        "|---|---|---|---|---|---|---|---|",
        *rows,
    ])
    meta = {
        "_source": "Generated by eval/summarize_results.py from the Kaggle results.json (run v2, 2026-11-03, all 5 models evaluated)",
        "_note": "clean_* = leak-free subset (n=3,153; upper bound: no patient-level split). full_* = original leaky validation split (n=10,079).",
    }
    return {**meta, "models": models}, md


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python eval/summarize_results.py path/to/results.json")
    with open(sys.argv[1], encoding="utf-8") as fh:
        metrics, table = summarize(json.load(fh))
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "model_metrics.json"), "w", encoding="utf-8") as fh:
        json.dump(metrics, fh, indent=2)
    with open(os.path.join(here, "RESULTS_TABLE.md"), "w", encoding="utf-8") as fh:
        fh.write(table + "\n")
    print(table)
    print("\nWrote eval/model_metrics.json and eval/RESULTS_TABLE.md")
