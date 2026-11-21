"""Render reports/FINAL_QA_REPORT.md to HTML (minimal Markdown subset) for PDF printing.
Usage: python tools/qa/report_pdf.py  -> reports/evidence/tmp/final_report.html"""
import html
import re
from pathlib import Path

src = Path("reports/FINAL_QA_REPORT.md").read_text(encoding="utf-8").splitlines()


def inline(t: str) -> str:
    t = html.escape(t, quote=False)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(?<![\w*])\*([^*]+)\*(?!\w)", r"<em>\1</em>", t)
    return t


out, i = [], 0
while i < len(src):
    line = src[i]
    if line.startswith("#"):
        level = len(line) - len(line.lstrip("#"))
        out.append(f"<h{level}>{inline(line[level:].strip())}</h{level}>")
    elif line.startswith("|"):
        rows = []
        while i < len(src) and src[i].startswith("|"):
            rows.append([c.strip() for c in src[i].strip().strip("|").split("|")])
            i += 1
        aligns = ["right" if c.endswith(":") else "left" for c in rows[1]]
        out.append("<table><thead><tr>" + "".join(f"<th style='text-align:{a}'>{inline(c)}</th>" for c, a in zip(rows[0], aligns)) + "</tr></thead><tbody>")
        out += ["<tr>" + "".join(f"<td style='text-align:{a}'>{inline(c)}</td>" for c, a in zip(r, aligns)) + "</tr>" for r in rows[2:]]
        out.append("</tbody></table>")
        continue
    elif re.match(r"^(\d+\.|-) ", line):
        tag = "ol" if line[0].isdigit() else "ul"
        out.append(f"<{tag}>")
        while i < len(src) and re.match(r"^(\d+\.|-) ", src[i]):
            out.append(f"<li>{inline(re.sub(r'^(\d+\.|-) ', '', src[i]))}</li>")
            i += 1
        out.append(f"</{tag}>")
        continue
    elif line.strip():
        out.append(f"<p>{inline(line)}</p>")
    i += 1

css = """
@page { size: A4; margin: 16mm 14mm 18mm; }
body { font-family: 'Segoe UI', Arial, sans-serif; color: #1c2533; font-size: 9.5pt; line-height: 1.45; }
h1 { font-size: 20pt; color: #12305c; border-bottom: 3px solid #2563eb; padding-bottom: 6px; margin: 0 0 4px; }
h2 { font-size: 13pt; color: #12305c; margin: 18px 0 6px; padding-top: 4px; border-top: 1px solid #dfe5ee; page-break-after: avoid; }
p { margin: 5px 0; }
table { border-collapse: collapse; width: 100%; margin: 6px 0 10px; font-size: 8.3pt; page-break-inside: auto; }
tr { page-break-inside: avoid; }
th { background: #eef3fb; color: #12305c; font-weight: 600; }
th, td { border: 1px solid #d5dce6; padding: 3px 5px; vertical-align: top; }
code { font-family: Consolas, monospace; font-size: 8pt; background: #f2f4f7; padding: 0 2px; border-radius: 2px; }
ul, ol { margin: 4px 0 8px 18px; padding: 0; } li { margin: 2px 0; }
strong { color: #0f1d33; }
"""
Path("reports/evidence/tmp").mkdir(parents=True, exist_ok=True)
Path("reports/evidence/tmp/final_report.html").write_text(f"<!doctype html><html lang='en'><head><meta charset='utf-8'><title>AI-NEGOCE Final QA Report</title><style>{css}</style></head><body>{''.join(out)}</body></html>", encoding="utf-8")
print("ok")
