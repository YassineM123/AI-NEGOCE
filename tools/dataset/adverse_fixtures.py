"""Deterministic ADVERSE fixtures for AI-NEGOCE QA (all fictional).

Writes, under fixtures/adverse/:
  invoices/invoice_anomalies.json   supplier-invoice cases + expected validation codes
  bi/bi_anomalies.json              mini datasets + expected BI behaviour
  ocr/*.png|jpg|pdf + ocr/ground_truth.json   real image/PDF files for OCR tests
  upload/*                          malformed / hostile upload files + expected HTTP status

Usage: python tools/dataset/adverse_fixtures.py
"""
from __future__ import annotations

import json
import random
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2] / "fixtures" / "adverse"
rng = random.Random(20261015)
FONT = "C:/Windows/Fonts/arial.ttf"
FONT_BOLD = "C:/Windows/Fonts/arialbd.ttf"
MONO = "C:/Windows/Fonts/consola.ttf"
M = Decimal("0.001")


def q(x) -> Decimal:
    return Decimal(str(x)).quantize(M, rounding=ROUND_HALF_UP)


def line(desc, qty, price, vat, disc=0, product_id=None):
    ht = q(Decimal(qty) * Decimal(str(price)) * (100 - Decimal(disc)) / 100)
    return {
        "productId": product_id,
        "description": desc,
        "quantity": qty,
        "unitPrice": str(q(price)),
        "discountPct": disc,
        "vatRate": vat,
        "lineHt": str(ht),
        "lineVat": str(q(ht * vat / 100)),
    }


def invoice(number, supplier="SUP-001", po="PO-00001", lines=None, stamp="1.000", currency="TND", date="2026-03-12"):
    lines = lines or [line("Ramette A4 Eco", 50, "9.500", 7, product_id="PRD-00005"), line("Toner Ravi Pro", 4, "185.000", 19, product_id="PRD-00007")]
    ht = sum(Decimal(l["lineHt"]) for l in lines)
    vat = sum(Decimal(l["lineVat"]) for l in lines)
    return {
        "supplierId": supplier,
        "supplierName": "STE Ravino SARL [FICTIF]",
        "invoiceNumber": number,
        "invoiceDate": date,
        "purchaseOrderId": po,
        "currency": currency,
        "lines": lines,
        "totals": {"ht": str(q(ht)), "vat": str(q(vat)), "stamp": stamp, "ttc": str(q(ht + vat + Decimal(stamp)))},
    }


def invoice_cases():
    base = invoice("F001-2026-0041")
    cases = [("VALID_BASELINE", base, [], "Accept: all checks pass.")]

    def variant(case_id, mutate, expected, behaviour):
        inv = json.loads(json.dumps(base))
        mutate(inv)
        cases.append((case_id, inv, expected, behaviour))

    variant("DUPLICATE_INVOICE", lambda i: i.update(invoiceNumber="F001-2026-0042"), ["DUPLICATE_INVOICE"], "Reject: same supplier + invoice number already registered (F001-2026-0042).")
    variant("MISSING_INVOICE_NUMBER", lambda i: i.update(invoiceNumber=""), ["MISSING_INVOICE_NUMBER"], "Block approval until a number is entered.")
    variant("MISSING_SUPPLIER", lambda i: i.update(supplierId=None), ["MISSING_SUPPLIER"], "Block approval until the supplier is resolved.")
    variant("INCORRECT_TOTAL", lambda i: i["totals"].update(ttc="999.999"), ["TOTAL_MISMATCH"], "Flag: TTC differs from HT + VAT + stamp.")
    variant("VAT_MISMATCH", lambda i: i["totals"].update(vat=str(q(Decimal(i["totals"]["vat"]) + 12))), ["VAT_MISMATCH", "TOTAL_MISMATCH"], "Flag: header VAT differs from sum of line VAT.")
    variant("LINE_VAT_WRONG_RATE", lambda i: i["lines"][1].update(lineVat=str(q(Decimal(i["lines"][1]["lineHt"]) * Decimal("0.07")))), ["LINE_VAT_MISMATCH", "VAT_MISMATCH"], "Flag: line VAT inconsistent with its rate.")
    variant("NEGATIVE_QUANTITY", lambda i: i["lines"][0].update(quantity=-50, lineHt="-475.000", lineVat="-33.250"), ["NEGATIVE_QUANTITY", "HT_MISMATCH", "VAT_MISMATCH"], "Reject on a supplier invoice (a return must be a credit note).")
    variant("UNUSUAL_DISCOUNT", lambda i: i["lines"].__setitem__(0, line("Ramette A4 Eco", 50, "9.500", 7, disc=85, product_id="PRD-00005")), ["UNUSUAL_DISCOUNT", "HT_MISMATCH", "VAT_MISMATCH"], "Flag for review: discount > 30 %.")
    variant("CURRENCY_INCONSISTENT", lambda i: i.update(currency="EUR"), ["CURRENCY_MISMATCH"], "Flag: currency differs from the TND ledger.")
    variant("UNKNOWN_VAT_RATE", lambda i: i["lines"].__setitem__(1, line("Toner Ravi Pro", 4, "185.000", 21, product_id="PRD-00007")), ["UNKNOWN_VAT_RATE", "VAT_MISMATCH"], "Flag: rate not in configured scenario set {0,7,13,19}.")
    variant("DUPLICATE_PRODUCT_LINE", lambda i: i["lines"].append(dict(i["lines"][0])), ["DUPLICATE_LINE", "HT_MISMATCH", "VAT_MISMATCH"], "Flag: the same product appears twice with identical values.")
    variant("WRONG_PO_REFERENCE", lambda i: i.update(purchaseOrderId="PO-99999"), ["UNKNOWN_PURCHASE_ORDER"], "Flag: purchase order does not exist.")
    variant("LINE_ARITHMETIC_ERROR", lambda i: i["lines"][0].update(lineHt="500.000"), ["LINE_TOTAL_MISMATCH", "LINE_VAT_MISMATCH", "HT_MISMATCH"], "Flag: quantity x unit price differs from line HT.")
    mv = invoice("F001-2026-0077", lines=[line("Ramette A4 Eco", 10, "9.500", 7, product_id="PRD-00005"), line("Savon liquide", 6, "4.200", 13, product_id="PRD-00008"), line("Toner Ravi Pro", 1, "185.000", 19, product_id="PRD-00007"), line("Carton double", 30, "1.150", 0, product_id="PRD-00011")])
    cases.append(("MULTIPLE_VAT_RATES_VALID", mv, [], "Accept: mixed VAT rates reconcile."))
    return [
        {"id": cid, "invoice": inv, "expectedCodes": sorted(set(codes)), "expectedBehaviour": beh}
        for cid, inv, codes, beh in cases
    ]


def bi_cases():
    def sale(i, **kw):
        row = {"id": f"BI-{i:03d}", "invoiceId": f"BI-{i:03d}", "date": "2026-02-10", "agency": "Tunis Centre", "customer": "CLIENT A [FICTIF]", "product": "Produit A", "family": "Bureaux", "representative": "Rep A", "revenue": 1000, "cost": 700, "paid": True}
        row.update(kw)
        return row

    return [
        {"id": "NEGATIVE_MARGIN", "sales": [sale(1, revenue=500, cost=800)], "expect": {"revenue": 500, "cost": 800, "grossMargin": -300, "grossMarginPercent": -60}},
        {"id": "ZERO_REVENUE_PERIOD", "sales": [], "expect": {"revenue": 0, "grossMargin": 0, "grossMarginPercent": None}, "note": "Margin % must be null (undefined), never NaN/Infinity or a fabricated 0."},
        {"id": "MISSING_COST", "sales": [sale(1), sale(2, cost=None)], "expect": {"revenue": 2000, "cost": 700, "missingCostRecords": 1, "marginCoverage": "partial"}, "note": "Missing cost must not be read as 0 (which would show 100 % margin)."},
        {"id": "CANCELLED_INVOICE", "sales": [sale(1), sale(2, status="cancelled")], "expect": {"revenue": 1000, "recordCount": 1}},
        {"id": "CREDIT_NOTE", "sales": [sale(1), sale(2, kind="credit_note", revenue=200, cost=140)], "expect": {"revenue": 800, "cost": 560}},
        {"id": "PARTIAL_PAYMENT", "sales": [sale(1, paid=False, outstanding=400)], "expect": {"receivables": 400}},
        {"id": "DUPLICATE_TRANSACTION", "sales": [sale(1), sale(1)], "expect": {"duplicateIds": ["BI-001"]}, "note": "Duplicate fact ids must be detected (data quality), not double counted silently."},
        {"id": "OUT_OF_PERIOD", "sales": [sale(1, date="2026-01-31"), sale(2, date="2026-02-01"), sale(3, date="2026-02-28"), sale(4, date="2026-03-01")], "filters": {"from": "2026-02-01", "to": "2026-02-28"}, "expect": {"revenue": 2000, "recordCount": 2}},
        {"id": "INCONSISTENT_AGENCY_ID", "sales": [sale(1, agency="Tunis Centre"), sale(2, agency="TUNIS CENTRE "), sale(3, agency="AG01")], "filters": {"agency": "Tunis Centre"}, "expect": {"revenue": 1000, "unmatchedAgencyLabels": ["AG01", "TUNIS CENTRE "]}, "note": "Unknown agency labels must be surfaced by data-quality checks."},
        {"id": "FLOAT_PRECISION", "sales": [sale(i, revenue=0.1, cost=0.0) for i in range(1, 11)], "expect": {"revenue": 1.0}, "note": "0.1 x 10 must equal exactly 1.000 TND."},
    ]


# ---------------- OCR image fixtures ----------------
def ar(text_visual: str) -> str:
    """Arabic is supplied pre-shaped (presentation forms, visual order): PIL lacks libraqm here."""
    return text_visual


GT_LINES = [("Ramette A4 Eco 80g", 50, "9.500", 7), ("Toner Ravi Pro 85A", 4, "185.000", 19), ("Classeur dos 8cm", 24, "3.750", 19)]


def ground_truth(number="F001-2026-0042", lines=GT_LINES):
    ls = [line(d, qt, p, v) for d, qt, p, v in lines]
    inv = invoice(number, lines=ls)
    inv["supplierTaxId"] = "1234567A/A/M/000"
    return inv


def fmt(amount: str, decimal=".", thousands=" "):
    whole, frac = amount.split(".")
    neg = whole.startswith("-")
    whole = whole.lstrip("-")
    groups = []
    while whole:
        groups.insert(0, whole[-3:])
        whole = whole[:-3]
    return ("-" if neg else "") + thousands.join(groups or ["0"]) + decimal + frac


def render(gt, *, decimal=".", thousands=" ", arabic=False, layout="standard", drop=(), confusable=False, size=(1240, 1754)):
    img = Image.new("RGB", size, "white")
    d = ImageDraw.Draw(img)
    f = lambda s, b=False: ImageFont.truetype(FONT_BOLD if b else FONT, s)
    W, H = size
    s = W / 1240
    y = int(70 * s)
    number = gt["invoiceNumber"]
    if confusable:
        number = number.replace("0", "O").replace("1", "l")
    d.text((int(70 * s), y), gt["supplierName"].replace(" [FICTIF]", ""), font=f(int(40 * s), True), fill="black")
    d.text((int(70 * s), y + int(55 * s)), f"MF : {gt['supplierTaxId']}  —  Zone industrielle, Ben Arous (FICTIF)", font=f(int(22 * s)), fill="black")
    if arabic:
        d.text((int(W - 330 * s), y), ar("\uFE93\uFEAD\uFEEE\uFE97\uFE8E\uFED3"), font=f(int(48 * s), True), fill="black")  # فاتورة
        d.text((int(W - 330 * s), y + int(60 * s)), ar("\uFEB2\uFEE7\uFEEE\uFE97") + " - Tunis", font=f(int(28 * s)), fill="black")  # تونس
    head_y = y + int(140 * s)
    if "invoiceNumber" not in drop:
        d.text((int(70 * s), head_y), f"FACTURE N° {number}", font=f(int(30 * s), True), fill="black")
    d.text((int(70 * s), head_y + int(45 * s)), f"Date : {gt['invoiceDate'][8:10]}/{gt['invoiceDate'][5:7]}/{gt['invoiceDate'][:4]}     Bon de commande : {gt['purchaseOrderId']}", font=f(int(24 * s)), fill="black")
    d.text((int(70 * s), head_y + int(80 * s)), "Client : AI-NEGOCE DEMO [FICTIF] — Devise : TND", font=f(int(24 * s)), fill="black")
    totals_block_y = head_y + int(140 * s) if layout == "totals_first" else None
    table_y = head_y + int(150 * s) + (int(200 * s) if layout == "totals_first" else 0)
    cols = [70, 560, 700, 880, 980] if layout != "totals_first" else [70, 520, 650, 840, 960]
    hdr = ["Désignation", "Qté", "P.U. HT", "TVA", "Total HT"]
    for c, h in zip(cols, hdr):
        d.text((int(c * s), table_y), h, font=f(int(24 * s), True), fill="black")
    d.line([(int(60 * s), table_y + int(35 * s)), (int(W - 60 * s), table_y + int(35 * s))], fill="black", width=max(1, int(2 * s)))
    ry = table_y + int(50 * s)
    for l in gt["lines"]:
        vals = [l["description"], str(l["quantity"]), fmt(l["unitPrice"], decimal, thousands), f"{l['vatRate']} %", fmt(l["lineHt"], decimal, thousands)]
        for c, v in zip(cols, vals):
            d.text((int(c * s), ry), v, font=f(int(24 * s)), fill="black")
        ry += int(42 * s)
    t = gt["totals"]
    rows = [("Total HT", t["ht"]), ("Total TVA", t["vat"]), ("Timbre fiscal", t["stamp"]), ("Net à payer TTC", t["ttc"])]
    rows = [r for r in rows if not ("totals" in drop and r[0] != "Total HT")]
    ty = totals_block_y if totals_block_y else ry + int(60 * s)
    for label, value in rows:
        d.text((int(700 * s), ty), label, font=f(int(26 * s), label.startswith("Net")), fill="black")
        d.text((int(980 * s), ty), fmt(value, decimal, thousands), font=f(int(26 * s), label.startswith("Net")), fill="black")
        ty += int(40 * s)
    d.text((int(70 * s), H - int(90 * s)), "Document de test fictif — AI-NEGOCE QA", font=f(int(18 * s)), fill="gray")
    return img


def minimal_text_pdf(gt) -> bytes:
    lines_txt = [f"FACTURE N {gt['invoiceNumber']}", f"Date {gt['invoiceDate']}", f"Fournisseur {gt['supplierName']}", f"MF {gt['supplierTaxId']}"]
    lines_txt += [f"{l['description']} | {l['quantity']} | {l['unitPrice']} | TVA {l['vatRate']} | {l['lineHt']}" for l in gt["lines"]]
    lines_txt += [f"Total HT {gt['totals']['ht']}", f"Total TVA {gt['totals']['vat']}", f"Timbre {gt['totals']['stamp']}", f"Net a payer TTC {gt['totals']['ttc']}"]
    ops = ["BT", "/F1 11 Tf", "50 790 Td", "14 TL"] + [f"({t.encode('latin-1', 'replace').decode('latin-1').replace('(', '[').replace(')', ']')}) '" for t in lines_txt] + ["ET"]
    stream = "\n".join(ops).encode("latin-1")
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    out += b"".join(b"%010d 00000 n \n" % off for off in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return bytes(out)


def ocr_fixtures(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    gt = ground_truth()
    gt_multi = ground_truth("F001-2026-0043", GT_LINES + [(f"Article test {i:02d}", i, "2.500", 19) for i in range(1, 25)])
    manifest = []

    def save(name, img, truth, condition, **kw):
        path = out / name
        if name.endswith(".jpg"):
            img.save(path, "JPEG", quality=kw.get("quality", 85))
        elif name.endswith(".pdf"):
            img.save(path, "PDF", resolution=kw.get("dpi", 150.0), save_all=bool(kw.get("pages")), append_images=kw.get("pages", []))
        else:
            img.save(path, "PNG")
        manifest.append({"file": name, "condition": condition, "groundTruth": truth, "textLayer": False})

    clean = render(gt)
    save("clean_invoice.png", clean, gt, "clean 150-dpi scan, French")
    save("clean_invoice.jpg", clean, gt, "clean JPEG q85")
    save("rotated_7deg.png", clean.rotate(7, expand=True, fillcolor="white"), gt, "skewed 7 degrees")
    save("rotated_90.jpg", clean.rotate(90, expand=True), gt, "rotated 90 degrees")
    save("blurry.png", clean.filter(ImageFilter.GaussianBlur(3.2)), gt, "Gaussian blur r=3.2")
    save("low_resolution.png", clean.resize((310, 438)), gt, "downscaled to 310x438 px")
    save("low_resolution_scan.pdf", clean.resize((420, 594)).convert("L"), gt, "low-resolution image-only PDF", dpi=50.0)
    save("scanned_no_text_layer.pdf", clean.convert("L"), gt, "image-only PDF, no text layer")
    p1 = render(gt_multi, size=(1240, 1754))
    save("multipage_scanned.pdf", p1.convert("L"), gt_multi, "2-page image-only PDF (page 2 = continuation)", pages=[render(ground_truth("F001-2026-0043"), drop=("invoiceNumber",)).convert("L")])
    save("bilingual_fr_ar.png", render(gt, arabic=True), gt, "French + Arabic headings (pre-shaped glyphs)")
    gt_comma = json.loads(json.dumps(gt))
    save("decimal_comma.png", render(gt, decimal=",", thousands="."), gt_comma, "decimal comma, dot thousands separator (1.234,500)")
    gt_incomplete = json.loads(json.dumps(gt))
    gt_incomplete["invoiceNumber"] = None
    gt_incomplete["totals"] = {"ht": gt["totals"]["ht"], "vat": None, "stamp": None, "ttc": None}
    save("incomplete_invoice.png", render(gt, drop=("invoiceNumber", "totals")), gt_incomplete, "invoice number and VAT/TTC totals absent; must be reported missing, not invented")
    save("unusual_layout.png", render(gt, layout="totals_first"), gt, "totals printed above the line table")
    save("ocr_confusables.png", render(gt, confusable=True), gt, "printed invoice number uses O/l instead of 0/1 (expected normalisation to F001-2026-0042)")
    (out / "text_layer_invoice.pdf").write_bytes(minimal_text_pdf(gt))
    manifest.append({"file": "text_layer_invoice.pdf", "condition": "born-digital PDF with text layer", "groundTruth": gt, "textLayer": True})
    (out / "ground_truth.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def upload_fixtures(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    files = [
        ("fake_image.png", b"this is not an image", "image/png", 415, "content does not match declared type"),
        ("pdf_declared_as_png.png", b"%PDF-1.4\n%%EOF\n", "image/png", 415, "PDF bytes declared as PNG"),
        ("windows_exe.pdf", b"MZ\x90\x00" + bytes(200), "application/pdf", 415, "executable renamed .pdf"),
        ("vector.svg", b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "image/svg+xml", 415, "SVG with script is not an allowed type"),
        ("empty.pdf", b"", "application/pdf", 415, "zero-byte file"),
        ("macro.docx", b"PK\x03\x04" + bytes(100), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 415, "unsupported office format"),
        ("polyglot.pdf", b"%PDF-1.4\n<html><script>alert(document.domain)</script></html>\n%%EOF\n", "application/pdf", 201, "PDF magic + embedded HTML: accepted by signature check (residual risk: no antivirus / deep parsing)"),
    ]
    meta = []
    for name, data, mime, status, why in files:
        (out / name).write_bytes(data)
        meta.append({"file": name, "mimeType": mime, "expectedStatus": status, "reason": why})
    (out / "expected.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")


def main():
    (ROOT / "invoices").mkdir(parents=True, exist_ok=True)
    (ROOT / "bi").mkdir(parents=True, exist_ok=True)
    (ROOT / "invoices" / "invoice_anomalies.json").write_text(json.dumps({"registeredInvoices": [{"supplierId": "SUP-001", "invoiceNumber": "F001-2026-0042"}], "knownPurchaseOrders": ["PO-00001"], "cases": invoice_cases()}, ensure_ascii=False, indent=2), encoding="utf-8")
    (ROOT / "bi" / "bi_anomalies.json").write_text(json.dumps(bi_cases(), ensure_ascii=False, indent=2), encoding="utf-8")
    m = ocr_fixtures(ROOT / "ocr")
    upload_fixtures(ROOT / "upload")
    print(f"invoice cases: {len(invoice_cases())}, bi cases: {len(bi_cases())}, ocr files: {len(m)}")


if __name__ == "__main__":
    main()
