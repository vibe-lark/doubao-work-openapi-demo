// Values are never printed: findings identify only a path, revision and category.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const known = new Set();
const placeholder = (value) =>
  /^(?:cli_)?x+$/i.test(value) ||
  /^(?:your_|replace_|synthetic[-_]|test[-_]|example[-_]|placeholder)/i.test(
    value,
  );
for (const file of [resolve(root, ".env"), resolve(root, "..", ".env")]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Z_][A-Z_0-9]*)\s*=\s*(.*?)\s*$/i,
    );
    if (!match || !/(?:SECRET|TOKEN|APP_ID|CLIENT_ID|API_KEY)/i.test(match[1]))
      continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    if (value.length >= 8 && !placeholder(value)) known.add(value);
  }
}
function collectTokens(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) collectTokens(file);
    else if (entry.name.endsWith(".json")) {
      try {
        const data = JSON.parse(readFileSync(file, "utf8"));
        for (const key of ["access_token", "refresh_token"])
          if (typeof data[key] === "string" && data[key].length >= 8)
            known.add(data[key]);
      } catch {
        /* Unrelated local cache. */
      }
    }
  }
}
collectTokens(resolve(root, ".tokens"));
const findings = [];
let checked = 0;
function inspect(path, data, revision = "working-tree") {
  checked++;
  const text = data.toString("utf8");
  const kinds = [];
  if (/(?:^|\/)\.env(?:\.[^/]+)?$/.test(path) && !path.endsWith(".env.example"))
    kinds.push("environment file");
  if (/(?:^|\/)\.tokens\//.test(path)) kinds.push("token storage file");
  if (
    [...text.matchAll(/cli_[A-Za-z0-9]{8,}/g)].some((m) => !placeholder(m[0]))
  )
    kinds.push("App ID");
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))
    kinds.push("private key");
  if (
    /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16})/.test(
      text,
    )
  )
    kinds.push("access credential");
  if ([...known].some((value) => text.includes(value)))
    kinds.push("local credential value");
  const assignments = [
    ...text.matchAll(
      /(?:client_secret|app_secret|access_token|refresh_token|api_key)["']?\s*[:=]\s*["']([A-Za-z0-9._~+\/-]{16,})["']/gi,
    ),
  ];
  if (assignments.some((match) => !placeholder(match[1])))
    kinds.push("hard-coded credential");
  if (kinds.length) findings.push({ path, revision, kinds });
}
const staged = process.argv.includes("--staged");
const files = git(
  "ls-files",
  "-z",
  ...(staged ? [] : ["--cached", "--others", "--exclude-standard"]),
)
  .toString()
  .split("\0")
  .filter(Boolean);
for (const path of new Set(files)) {
  if (staged) inspect(path, git("show", `:${path}`), "index");
  else if (existsSync(resolve(root, path)))
    inspect(path, readFileSync(resolve(root, path)));
}
if (process.argv.includes("--history")) {
  inspect("(commit messages)", git("log", "--all", "--format=%B"), "all-refs");
  for (const line of git("rev-list", "--objects", "--all")
    .toString()
    .split("\n")) {
    const split = line.indexOf(" ");
    if (split < 0) continue;
    const oid = line.slice(0, split),
      path = line.slice(split + 1);
    if (git("cat-file", "-t", oid).toString().trim() === "blob")
      inspect(path, git("cat-file", "blob", oid), oid.slice(0, 12));
  }
}
console.log(
  JSON.stringify(
    { checked, localValuesCompared: known.size, findings },
    null,
    2,
  ),
);
if (findings.length) process.exitCode = 1;
