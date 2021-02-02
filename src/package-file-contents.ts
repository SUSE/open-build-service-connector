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

import { assert } from "./assert";
import { PackageFile } from "open-build-service-api";
import { Logger } from "pino";
import * as vscode from "vscode";
import { AccountManager, ApiUrl } from "./accounts";
import { ConnectionListenerLoggerBase } from "./base-components";
import { cmdPrefix } from "./constants";
import { GET_FILE_FROM_CACHE_COMMAND } from "./project-bookmarks";
import { isFileTreeElement, ProjectTreeItem } from "./project-view";

/** URI scheme of the read-only files */
export const OBS_PACKAGE_FILE_URI_SCHEME = "vscodeObsPackageFile";

/** custom authority since vscode lowercases it, so we cannot put information into it */
const URI_AUTHORITY = "remote_file";

export const SHOW_REMOTE_PACKAGE_FILE_CONTENTS_COMMAND = `${cmdPrefix}.RemotePackageFile.showRemotePackageFileContents`;

export interface PackageFileUriData {
  apiUrl: ApiUrl;
  pkgFile: PackageFile;
  revision?: string;
}

/**
 * This class can be used to provide the contents of arbitrary files from
 * packages on OBS.
 */
export class RemotePackageFileContentProvider
  extends ConnectionListenerLoggerBase
  implements vscode.TextDocumentContentProvider {
  public static uriToPackageFile(uri: vscode.Uri): PackageFileUriData {
    assert(
      uri.scheme === OBS_PACKAGE_FILE_URI_SCHEME &&
        uri.authority === URI_AUTHORITY
    );

    // FIXME: the authority is lowercased by vscode

    const projNamepkgNameAndFname = (uri.path[0] === "/"
      ? uri.path.slice(1)
      : uri.path
    ).split("/");
    const apiUrl = uri.query;
    const revision = uri.fragment === "" ? undefined : uri.fragment;

    if (projNamepkgNameAndFname.length !== 3) {
      throw new Error(
        `Got an invalid file URI: ${uri}. Expected the path to contain 2 elements, but got ${projNamepkgNameAndFname.length}`
      );
    }

    const projectName = projNamepkgNameAndFname[0];
    const packageName = projNamepkgNameAndFname[1];
    const name = projNamepkgNameAndFname[2];

    return { apiUrl, pkgFile: { name, projectName, packageName }, revision };
  }

  // TODO: maybe provide this event too?
  // (this fires when the text document contents change, i.e. if we pull a new version)
  // onDidChange?: Event<Uri>;

  private static packageFileToUri(
    apiUrl: string,
    packageFile: PackageFile,
    revision?: string
  ): vscode.Uri {
    const baseUri = `${OBS_PACKAGE_FILE_URI_SCHEME}://${URI_AUTHORITY}/${packageFile.projectName}/${packageFile.packageName}/${packageFile.name}?${apiUrl}`;
    return vscode.Uri.parse(
      revision === undefined ? baseUri : baseUri.concat(`#${revision}`),
      true
    );
  }

  constructor(accountManager: AccountManager, logger: Logger) {
    super(accountManager, logger);

    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(
        OBS_PACKAGE_FILE_URI_SCHEME,
        this
      ),
      vscode.commands.registerCommand(
        SHOW_REMOTE_PACKAGE_FILE_CONTENTS_COMMAND,
        this.showRemotePackageFileContents,
        this
      )
    );
  }

  public async provideTextDocumentContent(
    uri: vscode.Uri,
    token: vscode.CancellationToken
  ): Promise<string | undefined> {
    const {
      apiUrl,
      pkgFile
    } = RemotePackageFileContentProvider.uriToPackageFile(uri);

    const cachedFile = await vscode.commands.executeCommand<PackageFile>(
      GET_FILE_FROM_CACHE_COMMAND,
      apiUrl,
      pkgFile
    );

    if (token.isCancellationRequested) {
      return undefined;
    }

    return cachedFile?.contents?.toString();
  }

  /**
   * Opens a new text editor window/tab displaying the contents of the file
   * belonging to the provided [[FileTreeElement]].
   */
  public async showRemotePackageFileContents(
    element?: ProjectTreeItem
  ): Promise<void> {
    if (element === undefined || !isFileTreeElement(element)) {
      this.logger.error(
        "showRemotePackageFileContents called without an element or one that isn't a FileTreeElement"
      );
      return;
    }

    const uri = RemotePackageFileContentProvider.packageFileToUri(
      element.parentProject.apiUrl,
      {
        name: element.fileName,
        packageName: element.packageName,
        projectName: element.parentProject.name
      }
    );
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });
  }
}
