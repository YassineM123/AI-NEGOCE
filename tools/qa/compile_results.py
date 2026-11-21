"""Compile reports/TEST_EXECUTION_RESULTS.json from the raw evidence in reports/evidence/.
Usage: python tools/qa/compile_results.py"""
import csv
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

E = Path("reports/evidence")
j = lambda f: json.loads((E / f).read_text(encoding="utf-8"))


def vitest(name):
    r = j(name)
    files = {}
    for f in r["testResults"]:
        n = f["name"].replace("\\", "/").split("Design/")[-1]
        st = [a["status"] for a in f["assertionResults"]]
        files[n] = {"passed": st.count("passed"), "failed": st.count("failed"), "total": len(st)}
    return {"numTotalTests": r["numTotalTests"], "numPassedTests": r["numPassedTests"], "numFailedTests": r["numFailedTests"], "files": files}


def playwright(name):
    r = j(name)
    tests = []

    def walk(s):
        for sp in s.get("specs", []):
            for t in sp["tests"]:
                tests.append({"project": t["projectName"], "title": sp["title"], "status": t["results"][-1]["status"]})
        for c in s.get("suites", []):
            walk(c)

    for s in r["suites"]:
        walk(s)
    return {"startTime": r["stats"]["startTime"], "passed": sum(t["status"] == "passed" for t in tests), "failed": sum(t["status"] != "passed" for t in tests), "tests": tests}


pick = lambda d, *keys: {k: d[k] for k in keys if k in d}
bugs = list(csv.DictReader(open("reports/BUG_REGISTER.csv", encoding="utf-8")))
dq = j("data_quality_synthetic.json")
mut = j("data_quality_mutations.json")
res = {
    "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "environment": {"os": "Windows 11 (10.0.26200)", "node": "v24.14.0", "python": "3.12.10", "browser": "Google Chrome (system) via Playwright 1.56.1", "database": "none available (no PostgreSQL; Docker engine stopped) - MemoryStore used", "ocr": "disabled provider; no OCR engine installed", "llm": "none in codebase", "erp": "no real ERP; Unconfigured/Test adapters"},
    "commands": {"vitest": "LOG_LEVEL=silent QA_PHASE=<initial|final> npx vitest run", "e2e": "E2E_API_PORT=3201 E2E_WEB_PORT=5274 QA_PHASE=<phase> npx playwright test", "dataQuality": "python tools/qa/data_quality.py datasets/synthetic/v1", "mutation": "python tools/qa/mutation_check.py datasets/synthetic/v1", "oracle": "python tools/qa/bi_oracle.py datasets/synthetic/v1 reports/evidence/bi_expected.json", "perf": "npx tsx tools/qa/perf.ts", "typecheck": "npx tsc --noEmit", "build": "npx vite build", "audit": "npm audit"},
    "provenance": (E / "11_initial_rerun_note.log").read_text(encoding="utf-8"),
    "initial": {
        "vitest": vitest("vitest_initial.json"),
        "e2e": playwright("playwright_initial.json") | {"note": "run 12:53-12:56 local; an external tool modified src/ at 12:54-12:55 during this run"},
        "copilotBenchmark": pick(j("copilot_benchmark_initial.json"), "total", "passed", "byCategory", "criteria"),
        "biValidation": pick(j("bi_validation_initial.json"), "comparisons", "failedComparisons"),
        "invoiceValidation": pick(j("invoice_validation_initial.json"), "cases", "exactCases", "detectionRate"),
    },
    "final": {
        "vitest": vitest("vitest_final.json"),
        "e2e": playwright("playwright_final.json"),
        "copilotBenchmark": pick(j("copilot_benchmark_final.json"), "total", "passed", "byCategory", "criteria"),
        "biValidation": pick(j("bi_validation_final.json"), "comparisons", "failedComparisons"),
        "invoiceValidation": pick(j("invoice_validation_final.json"), "cases", "exactCases", "detectionRate", "falsePositives"),
        "ocrPipeline": {"uploadLatencyMs": j("ocr_pipeline_final.json")["uploadLatencyMs"], "ocrAccuracy": "NOT MEASURED - no OCR engine"},
    },
    "copilotHeldOut": {"v1": {"firstRun": "13/20", "afterFixes_notHeldOut": "20/20"}, "v2": {"trueHeldOut": "11/15 (12/15 automated; V14 downgraded on manual review)", "now": f'{j("copilot_holdout_final.json")["v2"]["passed"]}/15 after an external non-QA edit targeting these cases'}},
    "dataQuality": {"checks": len(dq), "recordEvaluations": sum(c["tested"] for c in dq), "failingChecks": sum(1 for c in dq if c["failed"]), "mutationDetection": f'{sum(m["detected"] for m in mut)}/{len(mut)}'},
    "performance": j("performance.json"),
    "bugs": {"total": len(bugs), "bySeverityStatus": {f"{k[0]}/{k[1]}": v for k, v in Counter((b["severity"], b["status"].split(" ")[0]) for b in bugs).items()}},
    "blocked": ["Real ERP export and ERP write (no contract/credentials)", "OCR accuracy (no engine)", "LLM evaluation (no provider)", "PostgreSQL store, migrations, backup/restore (no database)", "Login and session-expiry E2E journeys (no frontend auth flow)", "Real identity provider (tested with a local JWKS issuer only)"],
}
Path("reports/TEST_EXECUTION_RESULTS.json").write_text(json.dumps(res, indent=2, ensure_ascii=False), encoding="utf-8")
print(json.dumps({"vitest_initial": f'{res["initial"]["vitest"]["numPassedTests"]}/{res["initial"]["vitest"]["numTotalTests"]}', "vitest_final": f'{res["final"]["vitest"]["numPassedTests"]}/{res["final"]["vitest"]["numTotalTests"]}', "e2e_initial": f'{res["initial"]["e2e"]["passed"]}/{res["initial"]["e2e"]["passed"] + res["initial"]["e2e"]["failed"]}', "e2e_final": f'{res["final"]["e2e"]["passed"]}/{res["final"]["e2e"]["passed"] + res["final"]["e2e"]["failed"]}', "bugs": res["bugs"]}))
