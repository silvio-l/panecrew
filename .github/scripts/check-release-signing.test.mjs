import assert from "node:assert/strict";
import test from "node:test";

import { validateReleaseWorkflow } from "./check-release-signing.mjs";

const validWorkflow = `
jobs:
  release:
    steps:
      - name: Import Apple-Signierzertifikat
        env:
          APPLE_CERTIFICATE: \${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: \${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
        run: |
          security create-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
          security set-keychain-settings -lut 21600 build.keychain
          security default-keychain -s build.keychain
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
          security import /tmp/cert.p12 -k build.keychain -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
          security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" build.keychain
          security list-keychains -d user -s build.keychain
      - uses: tauri-apps/tauri-action@v1
        if: matrix.platform == 'macos-latest'
        env:
          APPLE_SIGNING_IDENTITY: \${{ secrets.APPLE_SIGNING_IDENTITY }}
`;

test("accepts the single, long-lived signing keychain setup", () => {
  assert.deepEqual(validateReleaseWorkflow(validWorkflow, "fixture.yml"), []);
});

test("rejects forwarding the certificate to Tauri", () => {
  const workflow = validWorkflow.replace(
    "          APPLE_SIGNING_IDENTITY:",
    "          APPLE_CERTIFICATE: duplicate\n          APPLE_SIGNING_IDENTITY:",
  );

  assert.match(
    validateReleaseWorkflow(workflow, "fixture.yml").join("\n"),
    /APPLE_CERTIFICATE must only be declared in the certificate import step/,
  );
});

test("rejects a signing keychain that can auto-lock during compilation", () => {
  const workflow = validWorkflow.replace(
    "          security set-keychain-settings -lut 21600 build.keychain\n",
    "",
  );

  assert.match(
    validateReleaseWorkflow(workflow, "fixture.yml").join("\n"),
    /set-keychain-settings -lut 21600/,
  );
});
