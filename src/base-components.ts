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

import { Logger } from "pino";
import * as vscode from "vscode";
import { ApiAccountMapping } from "./accounts";

/** Base class for components that should have access to the logger */
export class LoggingBase {
  constructor(protected readonly logger: Logger) {}
}

export class DisposableBase {
  protected disposables: vscode.Disposable[] = [];

  public dispose() {
    this.disposables.forEach(disp => disp.dispose());
  }
}

export class ConnectionListenerBase extends DisposableBase {
  protected currentConnections: ApiAccountMapping = {
    defaultApi: undefined,
    mapping: new Map()
  };

  constructor(onConnectionChange: vscode.Event<ApiAccountMapping>) {
    super();

    const disposable = onConnectionChange(apiAccountMapping => {
      this.currentConnections = apiAccountMapping;
    }, this);

    this.disposables.push(disposable);
  }
}

export class ConnectionListenerLoggerBase extends ConnectionListenerBase {
  constructor(
    onConnectionChange: vscode.Event<ApiAccountMapping>,
    protected readonly logger: Logger
  ) {
    super(onConnectionChange);
  }
}
