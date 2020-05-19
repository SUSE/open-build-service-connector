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

import { Package, PackageFile, Project } from "open-build-service-api";
import { Logger } from "pino";
import * as vscode from "vscode";
import { AccountManager, ActiveAccounts, ApiUrl } from "./accounts";

export class BasePackage implements Package {
  public readonly apiUrl: string;
  public readonly name: string;
  public readonly projectName: string;

  constructor(pkg: Package);
  constructor(apiUrl: string, name: string, projectName: string);
  constructor(
    pkgOrApiUrl: string | Package,
    name?: string,
    projectName?: string
  ) {
    if (typeof pkgOrApiUrl === "string") {
      this.apiUrl = pkgOrApiUrl;
      this.name = name!;
      this.projectName = projectName!;
    } else {
      this.apiUrl = pkgOrApiUrl.apiUrl;
      this.projectName = pkgOrApiUrl.projectName;
      this.name = pkgOrApiUrl.name;
    }
  }
}

export class BaseProject implements Project {
  public readonly apiUrl: string;
  public readonly name: string;

  constructor(project: Project);
  constructor(apiUrl: string, name: string);
  constructor(projectOrApiUrl: string | Project, name?: string) {
    if (typeof projectOrApiUrl === "string") {
      this.apiUrl = projectOrApiUrl;
      this.name = name!;
    } else {
      this.apiUrl = projectOrApiUrl.apiUrl;
      this.name = projectOrApiUrl.name;
    }
  }
}

export class BasePackageFile implements PackageFile {
  public readonly name: string;
  public readonly packageName: string;
  public readonly projectName: string;

  constructor(pkgFile: PackageFile);
  constructor(name: string, packageName: string, projectName: string);
  constructor(
    pkgFileOrName: string | PackageFile,
    packageName?: string,
    projectName?: string
  ) {
    if (typeof pkgFileOrName === "string") {
      this.name = pkgFileOrName;
      this.packageName = packageName!;
      this.projectName = projectName!;
    } else {
      this.name = pkgFileOrName.name;
      this.projectName = pkgFileOrName.projectName;
      this.packageName = pkgFileOrName.packageName;
    }
  }
}

/** Base class for components that should have access to the logger */
export class LoggingBase {
  constructor(protected readonly logger: Logger) {}
}

export class DisposableBase {
  protected disposables: vscode.Disposable[] = [];

  public dispose() {
    this.disposables.forEach((disp) => disp.dispose());
  }
}

export class LoggingDisposableBase extends DisposableBase {
  constructor(protected readonly logger: Logger) {
    super();
  }
}

export class ConnectionListenerBase extends DisposableBase {
  protected readonly activeAccounts: ActiveAccounts;
  protected readonly onAccountChange: vscode.Event<ApiUrl[]>;

  constructor(accountManager: AccountManager) {
    super();
    this.activeAccounts = accountManager.activeAccounts;
    this.onAccountChange = accountManager.onAccountChange;
  }
}

export class ConnectionListenerLoggerBase extends ConnectionListenerBase {
  constructor(
    accountManager: AccountManager,
    protected readonly logger: Logger
  ) {
    super(accountManager);
  }
}
