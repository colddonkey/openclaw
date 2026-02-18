/**
 * Test utilities for symlink-dependent tests.
 * Windows often requires admin privileges for symlink creation (EPERM).
 * Use canCreateSymlinks() to detect availability and skip tests when unavailable.
 */
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let _canSymlink: boolean | null = null;
let _canSymlinkSync: boolean | null = null;

/**
 * Detects whether the current process can create symlinks (async).
 * On Windows without admin, fs.symlink typically throws EPERM.
 * Caches result for the process lifetime.
 */
export async function canCreateSymlinks(): Promise<boolean> {
  if (_canSymlink !== null) {
    return _canSymlink;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-symlink-probe-"));
  const target = path.join(dir, "target");
  const link = path.join(dir, "link");
  try {
    await fs.writeFile(target, "probe");
    await fs.symlink(target, link);
    _canSymlink = true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") {
      _canSymlink = false;
    } else {
      throw err;
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  return _canSymlink;
}

/**
 * Synchronous symlink probe. Use for it.skipIf(canCreateSymlinksSync()).
 * Caches result on first call.
 */
export function canCreateSymlinksSync(): boolean {
  if (_canSymlinkSync !== null) {
    return _canSymlinkSync;
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), "openclaw-symlink-probe-"));
  const target = path.join(dir, "target");
  const link = path.join(dir, "link");
  try {
    writeFileSync(target, "probe");
    symlinkSync(target, link);
    _canSymlinkSync = true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") {
      _canSymlinkSync = false;
    } else {
      throw err;
    }
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  return _canSymlinkSync;
}
