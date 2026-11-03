"""
DataScoop - reproducible evaluation (run on Kaggle, GPU T4, as "Save & Run All").
Inputs : Kaggle dataset 'souriabdelmouhib/alzheimer-dataset' (folder DataScoop/) + 'datascoop-models' (the 6 .h5).
Outputs: /kaggle/working/{dataset_audit.json, clean_test.csv, dataset_index.csv, results.json, results_summary.csv}
Then locally:  python ml_service/eval/summarize_results.py results.json

Steps (same code as the three notebook cells):
  1. Rebuild EXACTLY the Keras validation split used in training (first 20% of sorted names per class).
  2. Leakage audit: exact duplicates (MD5), near-duplicates (flip-aware Pearson r on 64x64 grayscale),
     with a cross-class baseline (different classes = different patients) to justify the r > 0.98 threshold.
  3. Leak-free subset = validation images with no source copy (aug_<n>_<uuid>), no MD5 twin, no r > 0.98 twin in train.
  4. Evaluate every model, 2 preprocessings (/255 vs raw), full split vs leak-free subset,
     accuracy, macro-F1, per-class recall/precision, confusion matrix, 95% bootstrap CI, ECE.
"""
import os, re, glob, json, gc, time, hashlib
from collections import Counter
import numpy as np
import pandas as pd
from PIL import Image

# ---------------- 1) Exact Keras split ----------------
ROOT = next(p for p in glob.glob('/kaggle/input/**/DataScoop', recursive=True) if os.path.isdir(p))
KERAS_EXTS = tuple('.' + e for e in ('png', 'jpg', 'jpeg', 'bmp', 'ppm', 'tif', 'tiff'))

def keras_files(class_dir):
    out = []
    for root, _, files in sorted(os.walk(class_dir), key=lambda x: x[0]):   # Keras sorts sub-folders
        for f in sorted(files):                                             # ...and file names
            if f.lower().endswith(KERAS_EXTS):
                out.append(os.path.join(root, f))
    return out

classes = sorted(d for d in os.listdir(ROOT) if os.path.isdir(os.path.join(ROOT, d)))   # alphabetical = Keras order
split = {}
for c in classes:
    files = keras_files(os.path.join(ROOT, c))
    n_val = int(0.2 * len(files))                                           # Keras: validation = files[:int(0.2 n)]
    split[c] = {"val": files[:n_val], "train": files[n_val:]}
expected = {"MildDemented": 2179, "ModerateDemented": 2012, "NonDemented": 3200, "VeryMildDemented": 2688}
assert all(len(split[c]["val"]) == expected[c] for c in classes), "split differs from the training notebook"

# ---------------- 2) Leakage audit ----------------
allfiles = [f for c in classes for f in split[c]["train"] + split[c]["val"]]
groups = {}
for f in allfiles:                                                          # exact duplicates
    with open(f, 'rb') as fh:
        groups.setdefault(hashlib.md5(fh.read()).hexdigest(), []).append(f)

def load_arr(path):                                                         # z-scored 64x64 -> dot/4096 = Pearson r
    a = np.asarray(Image.open(path).convert('L').resize((64, 64), Image.BILINEAR), dtype=np.float32)
    return (a - a.mean()) / (a.std() + 1e-6)

cache = {c: {s: np.stack([load_arr(f) for f in split[c][s]]) for s in ("train", "val")} for c in classes}

def nn_corr(V, T):                                                          # closest train image (incl. mirrored)
    V2 = V.reshape(len(V), -1)
    T2 = np.concatenate([T.reshape(len(T), -1), T[:, :, ::-1].reshape(len(T), -1)])
    S = V2 @ T2.T / V2.shape[1]
    return S.max(1), S.argmax(1) % len(T)

nn = {c: nn_corr(cache[c]["val"], cache[c]["train"]) for c in classes}
baseline = {c: nn_corr(cache[c]["val"][:500], cache["NonDemented" if c != "NonDemented" else "MildDemented"]["train"])[0]
            for c in classes}
print({c: (float(np.median(nn[c][0])), float(np.mean(baseline[c] > 0.98))) for c in classes})
cache = None; gc.collect()

# ---------------- 3) Leak-free subset ----------------
UUID = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
def source_of(path):
    name = os.path.basename(path).lower()
    m = re.match(rf'^aug_\d+_({UUID})\.', name)
    if m: return m.group(1), "aug"
    m = re.match(rf'^({UUID})\.', name)
    if m: return m.group(1), "original"
    return name, "other"

md5_of = {f: h for h, fs in groups.items() for f in fs}
rows = []
for c in classes:
    for s in ("train", "val"):
        for i, f in enumerate(split[c][s]):
            src, kind = source_of(f)
            rows.append(dict(cls=c, split=s, path=f, src=src, kind=kind, md5=md5_of[f],
                             nn_r=float(nn[c][0][i]) if s == "val" else np.nan))
df = pd.DataFrame(rows)
train = df[df.split == "train"]
val = df[df.split == "val"].copy()
val["clean"] = ~((val.src.isin(set(train.src[train.kind != "other"])) & (val.kind != "other"))
                 | val.md5.isin(set(train.md5)) | (val.nn_r > 0.98))       # 0.98: never reached across classes
val[val.clean].to_csv("/kaggle/working/clean_test.csv", index=False)
print("clean:", int(val.clean.sum()), "/", len(val))                      # 3153 / 10079

# ---------------- 4) Model evaluation ----------------
import tensorflow as tf
from sklearn.metrics import accuracy_score, f1_score, recall_score, precision_score, confusion_matrix
for g in tf.config.list_physical_devices('GPU'):
    tf.config.experimental.set_memory_growth(g, True)                       # avoid GPU OOM between models

MODEL_DIR = next(iter(glob.glob('/kaggle/input/**/datascoop-models', recursive=True)))
MODELS = {"BestModel": ("best_model.h5", 224), "UltraBestModel": ("ultra_best_model.h5", 224),
          "EfficientNetB0": ("efficientnetb0_alzheimer.h5", 224), "AlzheimerCNN": ("alzheimer_cnn_model.h5", 224),
          "EfficientNetB3": ("efficientnetb3_alzheimer.h5", 300), "EfficientNetB4": ("best_model_B4_alzheimer.h5", 380)}
clean_paths = set(val[val.clean].path)
val_paths = [f for c in classes for f in split[c]["val"]]
y_true = np.array([i for i, c in enumerate(classes) for _ in split[c]["val"]])
is_clean = np.array([p in clean_paths for p in val_paths])
rng = np.random.default_rng(42)

def load_images(paths, size):                                               # same as app.py: RGB + LANCZOS
    out = np.empty((len(paths), size, size, 3), dtype=np.uint8)
    for i, p in enumerate(paths):
        with Image.open(p) as im:
            out[i] = np.asarray(im.convert("RGB").resize((size, size), Image.LANCZOS))
    return out

def predict(model, X, rescale, bs):
    return np.concatenate([model(X[i:i + bs].astype(np.float32) / (255.0 if rescale else 1.0), training=False).numpy()
                           for i in range(0, len(X), bs)])

def ece(y, p, bins=15):
    conf, pred, e = p.max(1), p.argmax(1), 0.0
    for lo, hi in zip(np.linspace(0, 1, bins + 1)[:-1], np.linspace(0, 1, bins + 1)[1:]):
        m = (conf > lo) & (conf <= hi)
        if m.any():
            e += m.mean() * abs((pred[m] == y[m]).mean() - conf[m].mean())
    return float(e)

def metrics(y, p, n_boot=1000):
    pred, L = p.argmax(1), list(range(len(classes)))
    out = {"n": int(len(y)), "accuracy": float(accuracy_score(y, pred)),
           "macro_f1": float(f1_score(y, pred, average="macro", labels=L, zero_division=0)),
           "recall": dict(zip(classes, recall_score(y, pred, average=None, labels=L, zero_division=0).round(4).tolist())),
           "precision": dict(zip(classes, precision_score(y, pred, average=None, labels=L, zero_division=0).round(4).tolist())),
           "pred_distribution": dict(zip(classes, np.bincount(pred, minlength=len(L)).tolist())),
           "confusion": confusion_matrix(y, pred, labels=L).tolist(), "ece": ece(y, p)}
    accs, f1s = [], []
    for _ in range(n_boot):                                                 # bootstrap 95% CI
        idx = rng.integers(0, len(y), len(y))
        accs.append(accuracy_score(y[idx], pred[idx]))
        f1s.append(f1_score(y[idx], pred[idx], average="macro", labels=L, zero_division=0))
    out["accuracy_ci95"] = [float(np.percentile(accs, 2.5)), float(np.percentile(accs, 97.5))]
    out["macro_f1_ci95"] = [float(np.percentile(f1s, 2.5)), float(np.percentile(f1s, 97.5))]
    return out

results = {}
for size in sorted({s for _, s in MODELS.values()}):
    X = load_images(val_paths, size)
    for name, (fname, s) in MODELS.items():
        if s != size:
            continue
        model = None
        try:
            model = tf.keras.models.load_model(os.path.join(MODEL_DIR, fname), compile=False)
            results[name] = {"file": fname, "input_size": size, "n_params": int(model.count_params())}
            for prep, rescale in (("div255", True), ("raw0_255", False)):
                p = predict(model, X, rescale, bs=64 if size <= 224 else 16)
                results[name][prep] = {"full_val": metrics(y_true, p), "clean": metrics(y_true[is_clean], p[is_clean])}
        except Exception as e:                                              # one broken model must not stop the others
            results[name] = {"file": fname, "load_error": f"{type(e).__name__}: {str(e)[:400]}"}
        finally:
            model = None; tf.keras.backend.clear_session(); gc.collect()
        json.dump(results, open("/kaggle/working/results.json", "w"), indent=2)   # saved after EACH model
    del X; gc.collect()
