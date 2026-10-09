// Compare names/outcomes, never timings or AI-generated prose.
import fs from "node:fs";
import path from "node:path";
const expectedDir = process.argv[2] || "qa/baseline/2026-10-02";
const actualDir = process.argv[3] || "qa/runs/latest";
const files = [
  "core-results.json",
  "mock-results.json",
  "speech-adapter-results.json",
  "operation-results.json",
  "regression-results.json",
];
const comparison = {
  newFailures: [],
  knownFailures: [],
  fixed: [],
  missing: [],
  changedFailureReasons: [],
};
const normalizeFailure = (message) => message?.replace(/records \d+ seconds/g, "records <elapsed> seconds");
for (const file of files) {
  const expected = JSON.parse(
    fs.readFileSync(path.join(expectedDir, file), "utf8"),
  ).results;
  const currentFile = path.join(actualDir, file);
  if (!fs.existsSync(currentFile)) {
    comparison.missing.push(file);
    continue;
  }
  const actual = JSON.parse(fs.readFileSync(currentFile, "utf8")).results;
  for (const old of expected) {
    const next = actual.find((r) => r.name === old.name);
    const name = `${file}: ${old.name}`;
    if (!next) {
      comparison.missing.push(name);
      continue;
    }
    if (!["pass", "fail"].includes(next.status)) {
      comparison.missing.push(`${name}: invalid status`);
      continue;
    }
    if (next.status === "fail" && old.status !== "fail")
      comparison.newFailures.push(name);
    if (next.status === "fail" && old.status === "fail") {
      comparison.knownFailures.push(name);
      if (normalizeFailure(next.error) !== normalizeFailure(old.error))
        comparison.changedFailureReasons.push({
          name,
          before: old.error,
          after: next.error,
        });
    }
    if (next.status === "pass" && old.status === "fail")
      comparison.fixed.push(name);
  }
  for (const next of actual) {
    if (
      !expected.some((old) => old.name === next.name) &&
      next.status === "fail"
    )
      comparison.newFailures.push(`${file}: ${next.name}`);
  }
}
console.log(JSON.stringify(comparison, null, 2));
if (
  comparison.newFailures.length ||
  comparison.missing.length ||
  comparison.changedFailureReasons.length
)
  process.exitCode = 1;
