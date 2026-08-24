#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_WORKFLOWS = [
  ".github/workflows/release-nightly.yml",
  ".github/workflows/release-stable.yml",
];

function workflowSteps(source) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const steps = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)- (?:name|uses):/);
    if (!match) continue;

    const indentation = match[1].length;
    let end = index + 1;
    while (end < lines.length) {
      const nextStep = lines[end].match(/^(\s*)- (?:name|uses):/);
      if (nextStep && nextStep[1].length === indentation) break;
      end += 1;
    }

    steps.push(lines.slice(index, end).join("\n"));
    index = end - 1;
  }

  return steps;
}

function countDeclarations(source, variable) {
  const pattern = new RegExp(`^\\s+${variable}:`, "gm");
  return source.match(pattern)?.length ?? 0;
}

export function validateReleaseWorkflow(source, path = "release workflow") {
  const errors = [];
  const steps = workflowSteps(source);
  const importSteps = steps.filter((step) =>
    step.startsWith("- name: Import Apple-Signierzertifikat") ||
    /^\s*- name: Import Apple-Signierzertifikat/m.test(step),
  );

  if (importSteps.length !== 1) {
    errors.push(`${path}: expected exactly one Apple certificate import step`);
    return errors;
  }

  const importStep = importSteps[0];
  const requiredImportFragments = [
    "security set-keychain-settings -lut 21600 build.keychain",
    "security default-keychain -s build.keychain",
    "security unlock-keychain -p \"$KEYCHAIN_PASSWORD\" build.keychain",
    "security import /tmp/cert.p12 -k build.keychain",
    "-T /usr/bin/codesign",
    "security set-key-partition-list",
    "security list-keychains -d user -s build.keychain",
  ];

  for (const fragment of requiredImportFragments) {
    if (!importStep.includes(fragment)) {
      errors.push(`${path}: certificate import step must contain: ${fragment}`);
    }
  }

  for (const variable of ["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD"]) {
    if (countDeclarations(source, variable) !== 1 || !importStep.includes(`${variable}:`)) {
      errors.push(
        `${path}: ${variable} must only be declared in the certificate import step`,
      );
    }
  }

  const tauriSteps = steps.filter((step) =>
    step.includes("uses: tauri-apps/tauri-action@v1"),
  );
  if (tauriSteps.length === 0) {
    errors.push(`${path}: expected at least one tauri-action release step`);
  }

  for (const step of tauriSteps) {
    if (/^\s+APPLE_CERTIFICATE(?:_PASSWORD)?:/m.test(step)) {
      errors.push(
        `${path}: tauri-action must reuse build.keychain instead of importing APPLE_CERTIFICATE`,
      );
    }

    if (step.includes("macos-latest") && !step.includes("APPLE_SIGNING_IDENTITY:")) {
      errors.push(`${path}: macOS tauri-action must declare APPLE_SIGNING_IDENTITY`);
    }
  }

  return errors;
}

function main(paths) {
  let failed = false;

  for (const path of paths.length > 0 ? paths : DEFAULT_WORKFLOWS) {
    const errors = validateReleaseWorkflow(readFileSync(path, "utf8"), path);
    if (errors.length === 0) {
      console.log(`Release signing guard passed: ${path}`);
      continue;
    }

    failed = true;
    for (const error of errors) {
      console.error(`::error file=${path}::${error}`);
    }
  }

  if (failed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
