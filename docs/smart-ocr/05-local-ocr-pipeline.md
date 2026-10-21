# Local Smart OCR pipeline

The MVP uses an entirely local, evidence-preserving pipeline:

1. Validate PDF/PNG/JPEG content and store it under a random server key.
2. Read a PDF text layer when usable; otherwise rasterize locally.
3. Run Tesseract locally for images/scans with bounded pages and per-page timeout.
4. Preserve page, word/line bounding boxes, rotation, confidence, warnings, and processing events.
5. Extract only values observed in OCR evidence; report required fields that were not found.
6. Calculate derived VAT with exact decimal arithmetic and retain the source line coordinates.
7. Require deterministic financial validation and explicit human approval before any integration.

The current parser supports the demonstrated Tunisian invoice format and is intentionally conservative. It is not a general trained invoice model. Broader templates must be added through measured parser variants and fixture tests; missing values remain missing rather than being invented.

Known production boundary: OCR currently executes inside upload/retry requests. A production deployment should move recognition to the existing processing-job model with bounded workers, resource limits, persistence, and polling before accepting untrusted multi-page volume.
