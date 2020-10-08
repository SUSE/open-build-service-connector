/**
 * Copyright (c) 2020 SUSE LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import { rmRf } from "open-build-service-api";
import { tmpdir } from "os";
import { isAbsolute, relative } from "path";

/**
 * @return The prefix for the temporary directory for tests, either the OS'
 *     temporary directory or the contents of TMPDIR.
 */
export function getTmpPrefix(): string {
  return process.env.TMPDIR ?? tmpdir();
}

/**
 * Remove `path` recursively, but only if it is a subdirectory of the temporary
 * directory as returned by [[getTmpPrefix]].
 */
export async function safeRmRf(path: string): Promise<void> {
  const prefix = getTmpPrefix();
  const relPath = relative(prefix, path);
  const isSubdir = relPath && !relPath.startsWith("..") && !isAbsolute(relPath);
  if (!isSubdir) {
    throw new Error(`Will not remove anything outside of ${prefix}`);
  } else {
    await rmRf(path);
  }
}
