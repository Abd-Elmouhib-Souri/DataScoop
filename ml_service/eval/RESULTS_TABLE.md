| Model | Training split | Preproc. | Acc. (leaky val, n=10,079) | Acc. leak-free (n=3,153) [95% CI] | Macro-F1 leak-free [95% CI] | Recall Mild / Moderate / Non / VeryMild | Status |
|---|---|---|---|---|---|---|---|
| ResNet50 | known | div255 | 0.900 | **0.814** [0.800-0.826] | 0.832 [0.819-0.843] | 0.86 / 0.99 / 0.76 / 0.73 | enabled |
| CustomCNN | unknown | div255 | 0.810 | **0.784** [0.770-0.799] | 0.809 [0.796-0.821] | 0.87 / 1.00 / 0.61 / 0.77 | enabled |
| EfficientNetB0 | unknown | raw0_255 | 0.229 | **0.209** [0.195-0.222] | 0.170 [0.159-0.181] | 0.00 / 0.51 / 0.08 / 0.42 | disabled: broken |
| EfficientNetB3 | unknown | raw0_255 | 0.317 | **0.297** [0.280-0.311] | 0.121 [0.115-0.127] | 0.00 / 0.00 / 0.99 / 0.01 | disabled: broken |
| EfficientNetB4 | unknown | raw0_255 | 0.567 | **0.555** [0.539-0.573] | 0.545 [0.529-0.562] | 0.62 / 0.85 / 0.68 / 0.19 | disabled: too weak |
