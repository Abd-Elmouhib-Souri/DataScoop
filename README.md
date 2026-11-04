# DataScoop: Alzheimer MRI decision-support prototype

DataScoop is a full-stack research prototype. A doctor or patient uploads one **2D brain MRI slice**. CNN models classify it into 4 classes (*Non*, *Very Mild*, *Mild*, *Moderate Demented*). The result is stored in a doctor/patient platform with appointments, messaging and reports.

> ⚠️ **Research prototype, not a medical device.** The models were trained and evaluated on public 2D Kaggle slices without patient identifiers. Never use them for clinical decisions.

This README separates three things clearly: what is **measured**, what is **implemented**, and what is **not done yet**. Every number below comes from an evaluation run that anyone can reproduce (see [Evaluation](#evaluation)).

---

## What the project is

DataScoop is a team **PFA** (end-of-year project) at ESPRIM, Monastir, Tunisia.

| Part | Who |
|---|---|
| Backend (Node/Express/MongoDB), ML service (Flask), integration | **Abd Elmouhib Souri** |
| Training of the ResNet-50 (Kaggle notebook available) and of the custom CNN and one EfficientNet (notebooks lost) | **Abd Elmouhib Souri** |
| Patient / doctor dashboard UI | **Abd Elmouhib Souri** and **Achref** |
| Frontend scaffold | generated with [Lovable](https://lovable.dev) (React, TypeScript, Vite, Tailwind, shadcn/ui), then extended by the team |
| Data audit, evaluation, removal of simulated outputs, security hardening (Oct–Nov 2026) | **Abd Elmouhib Souri** |

The remaining EfficientNet models were trained within the team. Their training code is not available.

## Architecture

```mermaid
flowchart LR
  UI["React frontend<br/>(Vite, port 8080)"] -- "JWT (Bearer)" --> API["Node / Express API<br/>(port 5000)"]
  API -- "multipart image<br/>(server-to-server)" --> ML["Flask ML service<br/>(127.0.0.1:5001)"]
  API --- DB[("MongoDB")]
  ML --- M["Keras models<br/>ResNet-50, CustomCNN"]
  ML --- MET["eval/model_metrics.json<br/>(measured, not typed)"]
```

- **ML service** (`ml_service/app.py`): it loads **only** the models marked `enabled` in `eval/model_metrics.json`.
  - A missing or crashing model is **excluded and reported**.
  - If no model can answer, the API returns **HTTP 503**. It never produces a simulated diagnosis.
  - The verdict comes from a model **chosen in advance**: the best measured macro-F1. It is not chosen per image by softmax confidence, because softmax confidence is not calibrated.
  - A **basic input check** rejects obvious non-MRI images with HTTP 422: colour images, figures on a white background, thumbnails. This is *not* out-of-distribution detection.
- **Human-in-the-loop workflow** (the AI suggests, the doctor decides):

```mermaid
sequenceDiagram
  participant P as Patient
  participant API as Backend
  participant ML as ML service
  participant D as Patient's doctor
  P->>API: upload MRI slice
  API->>ML: classify
  ML-->>API: AI suggestion (2 models)
  API-->>P: "received, waiting for your doctor" (no AI output)
  API-->>D: "new MRI to review"
  D->>API: validate or correct + comment
  API-->>P: doctor's diagnosis + comment
```

- **What the patient sees**: never the AI output. Only the diagnosis **validated or corrected by his doctor**, with the doctor's comment, and a neutral "waiting for validation" state before that. No risk level is computed without a validated diagnosis.
- **What the doctor sees**: the AI suggestion (primary model, every model's prediction, uncalibrated probabilities), a **warning when the models disagree**, and a validate / correct form. During testing, screenshots, a FLAIR slice and a figure from a paper still produced 99–100% confidence: a classifier always answers, so confidence is not reliability.
- **Backend** (`backend/`): JWT authentication, bcrypt password hashes, and role and ownership checks.
  - A doctor sees **only the patients who chose him** (patients, scans, reports, statistics).
  - The doctor's dashboard, patient list, reports and AI-insights charts count **validated diagnoses**; scans not yet reviewed are shown as "En attente", never counted as a class.
  - A doctor's ad-hoc analysis (*Advanced Analysis*) is never saved as a patient record.
  - If the ML service fails, the backend answers 503 and **writes nothing** to the patient record.
- **Frontend** (`neuro-detect-lab-main/`): doctor and patient dashboards, PWA, Capacitor Android build.

---

## Evaluation

### Data audit: why the original 89–90% is not a valid performance number

The models were trained on a 50,400-image Kaggle folder (4 classes, **no test split, no patient IDs**) with a random 80/20 `validation_split`. An audit of that data found **three levels of leakage** (code: `ml_service/eval/kaggle_evaluation.py`):

1. **Exact duplicates.** There are 195 MD5 groups, and **110 of them are in both train and validation**.
2. **Augmented copies.** Files `aug_<n>_<uuid>.jpg` in training are copies of `<uuid>.jpg` in validation. 57–71% of validation images have a training image with Pearson r > 0.98 (64×64, flip-aware). Between images of **different classes**, which means different patients, **0.0%** reach r > 0.98. That baseline is how the threshold was chosen.
3. **Merged re-uploads.** The same well-known 6,400-image set appears in at least 3 formats (128×128 grayscale, 176×208 grayscale, 180×180 RGB). One format (200×190 grayscale) is almost only *Moderate*, so the image **format** alone can predict the class. That is a shortcut-learning risk.

A **leak-free subset** of the exact original validation split was built: 3,153 / 10,079 images with no source copy, no MD5 duplicate and no near-duplicate (r > 0.98) in training. Its median closest-train correlation is 0.925, the same as the different-patient baseline.

### Results (measured, Kaggle run v2, TensorFlow 2.20, 2× T4, 2026-11-03, all 5 models)

| Model (file) | Real architecture | Training split | Accuracy, original split (leaky, n=10,079) | **Accuracy, leak-free subset (n=3,153) [95% bootstrap CI]** | Macro-F1, leak-free [95% CI] | ECE, leak-free | Status |
|---|---|---|---|---|---|---|---|
| **ResNet50** (`ultra_best_model.h5`) | ResNet-50 (ImageNet) + dense head, fine-tuned | known | 0.900 | **0.814 [0.800–0.826]** | **0.832 [0.819–0.843]** | 0.028 | served (primary) |
| **CustomCNN** (`alzheimer_cnn_model.h5`) | 4-block CNN, 11.2 M params | **unknown** (notebook lost) | 0.810 | 0.784 [0.770–0.799] | 0.809 [0.796–0.821] | 0.047 | served (comparison) |
| EfficientNetB4 (`best_model_B4_alzheimer.h5`) | EfficientNet-B4, 380 px | unknown | 0.567 | 0.555 [0.539–0.573] | 0.545 [0.529–0.562] | 0.128 | **disabled: too weak** |
| EfficientNetB0 (`efficientnetb0_alzheimer.h5`) | EfficientNet-B0 | unknown | 0.229 | 0.209 | 0.170 | — | **disabled: broken** |
| EfficientNetB3 (`efficientnetb3_alzheimer.h5`) | EfficientNet-B3, 300 px | unknown | 0.317 | 0.297 (predicts "Non Demented" for 98% of images) | 0.121 | — | **disabled: broken** |

Recall per class on the leak-free subset (how often each true class is found):

| Model | Non Demented (n=938) | Very Mild (n=849) | Mild (n=926) | Moderate (n=440) |
|---|---|---|---|---|
| ResNet50 | 0.76 | **0.73** | 0.86 | 0.99 |
| CustomCNN | **0.61** | 0.77 | 0.87 | 1.00 |
| EfficientNetB4 | 0.68 | **0.19** | 0.62 | 0.85 |

How to read these tables:
- The pipeline is validated: on the original split, the ResNet-50 reproduces its training-notebook value (0.900 vs 0.8997), and run v2 gives the same accuracy and macro-F1 as run v1. **Leakage inflated accuracy by about 8.6 points.**
- **0.814 is still an upper bound**, not a clinical estimate. The split is not patient-level, a 64×64 correlation cannot catch strong augmentations or other slices of the same patient, and the clean subset comes mostly from one image source.
- **The errors are where they matter most.** The ResNet-50 misses about 1 in 4 "Very Mild" cases and labels about 1 in 4 healthy slices as demented; the CustomCNN misclassifies 39% of healthy slices. The near-perfect "Moderate" recall is the least trustworthy number: "Moderate" is the smallest class of the original data and was augmented the most, so its 440 clean images likely come from few source slices.
- The CustomCNN's training split is unknown, so its numbers may include images it was trained on.
- `best_model.h5`, presented in the old version as "ResNet-50, 89.25%", is **the same network as the CustomCNN**: identical predictions and metrics on all 10,079 images, in both runs. The 89.25% figure appears in no training log. It was removed.
- EfficientNet-B0 and B3 collapse to one or two classes with both preprocessings (/255 and raw 0–255), so they are disabled. Their low ECE with /255 (0.036–0.059) shows that **good calibration does not imply a useful model**.
- EfficientNet-B4 works (it rescales internally, so it expects raw 0–255 pixels) but is far weaker than the ResNet-50, with non-overlapping confidence intervals. **The "too weak" rule (gap > 0.10 macro-F1 to the best model) was added after seeing this run** and is reported as such: serving B4 would mostly trigger false "models disagree" warnings for the doctor.

To reproduce: run the Kaggle evaluation notebook (dataset audit, then leak-free subset, then model evaluation), then `python ml_service/eval/summarize_results.py results.json`. This rewrites `model_metrics.json` and the results table. **No accuracy in the code is typed by hand.**

---

## Security (what is implemented, with tests)

| Risk in the original code | Now | Proof |
|---|---|---|
| Patient records and MRIs readable and writable **without login** | JWT required; a patient sees only **his own** record; writes are doctor-only with a field whitelist | `backend/tests/security.test.js`, plus live HTTP: 401 without token |
| Token = Mongo `_id` or **email** | Signed **JWT** (HS256 pinned, 8 h expiry, secret ≥ 32 chars or the server refuses to start) | forged, `alg=none` and expired tokens → 401 |
| Plain-text passwords; login query built from the raw body | **bcrypt** (12 rounds) + migration script; lookup by email, then hash compare | `{"password":{"$ne":null}}` → **400** |
| Public, shared doctor key (`NEURO2026`) | **One-time invitation codes** (80-bit random, stored as SHA-256, 7-day expiry, consumed atomically) created with `scripts/create-doctor-invite.js` | tests: no code / old key → 401; a code works once |
| Every doctor could see every patient and every doctor's reports | A doctor only sees the patients who **chose him** (`assignedDoctor`); he cannot "take" a patient by opening a conversation | tests: other doctor → 403, list = own patients only |
| A former doctor could take a patient back (and see his scans) just by writing in an old conversation | The assignment changes **only when the patient chooses** a doctor; messages never change it | tests: former doctor writes → still 403; patient switches → access moves |
| AI result shown directly to the patient | **Human-in-the-loop**: the patient sees only the doctor's validated or corrected diagnosis | tests: patient view has no AI class or probabilities before review |
| Records linked by **name** (unanchored regex: "Ali" matched "Alia…") | Linked by account id or exact email only; name-based "auto-repair" removed | test: patient A cannot read patient B → 403 |
| CORS open to every origin | Allowed origins from `FRONTEND_ORIGIN` | — |
| Fake outputs: random diagnoses saved to records, random dashboard chart, invented "heatmap", drug doses and MRI findings generated from the class label, hard-coded "95.2% accuracy" | **All removed** | ML: `ml_service/tests`; backend: ML down → 503 and nothing written |

**Tests:** 17 Python tests (`cd ml_service && python -m pytest -q`) and 28 backend tests (`cd backend && npm test`); `tsc --noEmit` reports 0 errors on the frontend. Both suites run without TensorFlow or MongoDB. For the key guarantees, a mutation check was done: putting the old bug back makes the tests fail.

---

## Run it locally

Requirements: Node ≥ 18, Python 3.10+, MongoDB, and [Git LFS](https://git-lfs.com) (the models are ~435 MB).

```bash
git clone https://github.com/Abd-Elmouhib-Souri/DataScoop.git
cd DataScoop && git lfs pull                     # downloads the .h5 models (otherwise they are 130-byte pointers)

# 1) ML service
cd ml_service && python -m venv .venv && . .venv/bin/activate   # Windows: .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt && python app.py                # -> "Loaded: ['CustomCNN', 'ResNet50']"

# 2) Backend (new terminal)
cd backend && cp .env.example .env   # fill MONGO_URI and JWT_SECRET (see comments in the file)
npm install && node seed.js && npm start

# 3) Frontend (new terminal)
cd neuro-detect-lab-main && npm install && npm run dev          # http://localhost:8080
```

Seeded **local demo accounts**: `doctor@demo.com` and `user@demo.com`, password `password` (stored as bcrypt hashes). To create a real doctor account, generate an invitation: `node scripts/create-doctor-invite.js "Dr Name - hospital"` (the code is printed once, valid 7 days, single use). Change them before exposing the app anywhere. If you already have a database with plain-text passwords, run `node scripts/migrate-passwords.js` once. On Windows, `run_all.bat` starts the three services.

---

## Limitations and known issues

- **Data.** 2D slices from merged Kaggle uploads with no patient IDs. No patient-level split is possible on this data, so all numbers are optimistic upper bounds.
- **Model choice.** The 4 classes come from the source dataset labels (CDR-based in OASIS-derived sets). The models do not localise or measure anything, and no explainability (Grad-CAM) is implemented yet.
- **Calibration.** Confidence values are raw softmax outputs (ECE is reported above, but no calibration is applied).
- **Access control.** Emails are not verified at sign-up, and a patient's account is linked to a doctor-created record by exact email, so it trusts the email typed at registration. The JWT is stored in `localStorage` (an HttpOnly cookie would resist XSS better). There is no password reset. When a patient chooses another doctor, the **whole file** (past scans and reviews) moves to the new doctor, who sees the previous doctor's comments labelled as such; the previous doctor loses access but can still reply in the old conversation.
- **Input domain.** The input check only rejects obvious misuse. A T1-like slice from another scanner or dataset is still accepted and may receive a confident but wrong suggestion, which is one more reason the doctor validates every result.
- **Chatbot.** The "assistant" is a rule-based FAQ (keyword and word-overlap matching on a trilingual JSON). It is not an LLM, and is labelled "Assistant FAQ Alzheimer" in the app; it shows its source but no "confidence %" (those values were fixed constants of the rules). `ml_service/chatbot_service.py` is an unused earlier version. The darija phrasing mixes Moroccan and Tunisian forms.
- **Code debt.** 2 moderate `npm audit` findings remain in a dev-only dependency (`nodemon`/`minimatch`). The Android application id is still `com.neurodetectlab.app`; changing it would break existing installs.

## Next steps

1. Retrain the ResNet-50 on a dataset **with subject IDs** (e.g. OASIS-1) using a **patient-level split**, with augmentation applied only at training time.
2. Grad-CAM on held-out examples.
3. Temperature scaling, and a reliability diagram for the confidence values. Then a real out-of-distribution score (e.g. feature-space distance to the training set), so that the system can abstain.
4. Email verification, password reset, and an HttpOnly session cookie.
5. Docker Compose, CI running both test suites, and models hosted on the Hugging Face Hub instead of Git LFS.
