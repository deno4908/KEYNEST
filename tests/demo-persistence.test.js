import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  renameSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { writeDemoSnapshot } from "../server/demo-persistence.js";

test("demo persistence tolerates transient file locks and preserves the last commit on failure", () => {
  const dir = mkdtempSync(join(tmpdir(), "keynest-persistence-"));
  const path = join(dir, "demo.json");
  try {
    writeDemoSnapshot(path, { version: 1 });
    let attempts = 0;
    writeDemoSnapshot(path, { version: 2 }, (source, target) => {
      attempts++;
      if (attempts <= 2)
        throw Object.assign(new Error("Windows file lock"), { code: "EPERM" });
      renameSync(source, target);
    });
    assert.equal(attempts, 3);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).version, 2);
    assert.throws(
      () =>
        writeDemoSnapshot(path, { version: 3 }, () => {
          throw Object.assign(new Error("Disk failure"), { code: "EIO" });
        }),
      /Disk failure/,
    );
    assert.equal(JSON.parse(readFileSync(path, "utf8")).version, 2);
    assert.deepEqual(readdirSync(dir), ["demo.json"]);
  } finally {
    assert.ok(
      resolve(dir).startsWith(resolve(tmpdir()) + sep + "keynest-persistence-"),
    );
    rmSync(dir, { recursive: true, force: true });
  }
});
