import { writeFileSync, renameSync, unlinkSync } from "node:fs";

// A scanner/editor can briefly hold a Windows file open. Keep the previous
// committed file intact and retry only that transient rename failure.
export function writeDemoSnapshot(path, data, rename = renameSync) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(data, null, 2));
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        rename(temporary, path);
        return;
      } catch (error) {
        if (!["EPERM", "EBUSY", "EACCES"].includes(error.code) || attempt >= 5)
          throw error;
        Atomics.wait(
          new Int32Array(new SharedArrayBuffer(4)),
          0,
          0,
          20 * (attempt + 1),
        );
      }
    }
  } finally {
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
