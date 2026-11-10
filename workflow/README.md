# AK Scan workflows

The application is organized around three user-facing workflows:

- `scan-from-image`: phone photos → cleaned/scanned PDF, searchable PDF or editable Word (OCR). Owns the rule for applying an automatically detected crop on import.
- `scan-from-pdf-images`: image-only PDF pages → the same scan pipeline. Owns the classification of PDF pages into "document" (usable text layer) and "scan".
- `pdf-to-word`: text-layer PDF pages → editable Word rebuilt from the text layer and drawing graphics, without OCR.

Shared primitives live in `shared/core`: the pixel pipeline (runs in a Web Worker), page geometry, import adapter, OCR engine and post-processing, the text-layer layout engine, the export pipeline and the DOCX/PDF exporters. `ui/` is the browser shell. `scripts/` holds tests, synthetic fixtures and build helpers.
