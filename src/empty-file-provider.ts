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

import * as vscode from "vscode";
import { DisposableBase } from "./base-components";

export const EMPTY_DOCUMENT_SCHEME = "vscodeObsEmptyFile";

export class EmptyDocumentProvider extends DisposableBase
  implements vscode.TextDocumentContentProvider {
  public static buildUri(fileName: string): vscode.Uri {
    return vscode.Uri.parse(`${EMPTY_DOCUMENT_SCHEME}://${fileName}`);
  }

  constructor() {
    super();
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(
        EMPTY_DOCUMENT_SCHEME,
        this
      )
    );
  }

  public provideTextDocumentContent(
    uri: vscode.Uri,
    token: vscode.CancellationToken
  ): string | undefined {
    if (uri.scheme !== EMPTY_DOCUMENT_SCHEME) {
      throw new Error(
        `Invalid uri scheme ${uri.scheme}, expected ${EMPTY_DOCUMENT_SCHEME}`
      );
    }
    return token.isCancellationRequested ? undefined : "";
  }
}
