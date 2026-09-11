# Pinned AVeriTeC evaluation tooling

The official AVeriTeC eval script (ADR-0014 disposition: adopted as a pinned
scoring step, never a runtime dependency). Python exists nowhere else in the
runtime.

| File | Source commit | SHA-256 |
|---|---|---|
| `eval.py` | `MichSchli/AVeriTeC@7c62d1ec8df3fb560d6efe2b85fa191135636f81` (2024-11-27) | `01e325e5e19074037d1f1a7673b0f7999ecab82ee5ae3e81205efc86cc39b161` |
| `utils.py` | same | `d4b1bcbd0ec10210892e5d41521ffd6a0ae02e50ba336b8d84830f19dc33643e` |

Upgrade = replace both files, update this table, note in the run manifest
(HAR-R12: tool commit + environment pinned in the manifest; CI asserts the
checksums before any L3 scoring run).

Runtime deps (scoring environment only): `numpy scipy sklearn nltk leven`
plus NLTK tokenizer data. Run: `python eval.py --predictions p.json --references data/dev.json`.
