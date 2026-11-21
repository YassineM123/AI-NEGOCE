// Verify Git LFS test binaries were materialized before running OCR upload tests.
// A 130-byte LFS pointer sent to /api/v1/documents is correctly rejected as 415.
import fs from "node:fs"
import path from "node:path"

const directory = "fixtures/adverse"
const cases = JSON.parse(fs.readFileSync(path.join(directory, "ocr/ground_truth.json"), "utf8"))
const hostile = JSON.parse(fs.readFileSync(path.join(directory, "upload/expected.json"), "utf8"))
let checked = 0

function check(p, expected) {
  const file = fs.readFileSync(p)
  if (file.subarray(0, 43).toString("utf8").startsWith("version https://git-lfs.github.com/spec"))
    throw new Error(`QA fixture not materialized (Git LFS pointer): ${p}. Run git lfs pull.`)
  const name = path.basename(p).toLowerCase()
  if (expected === "valid") {
    const valid = name.endsWith(".png")
      ? file.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
      : name.endsWith(".jpg")
        ? file.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))
        : name.endsWith(".pdf") && file.subarray(0, 5).toString("latin1") === "%PDF-"
    if (!valid) throw new Error(`QA fixture invalid signature: ${p}`)
  }
  checked++
}

for (const f of cases) check(path.join(directory, "ocr", f.file), "valid")
for (const f of hostile) check(path.join(directory, "upload", f.file), f.expectedStatus === 201 ? "valid" : "hostile")
console.log(`Validated ${checked} real QA binary fixtures (no Git LFS pointers).`)
