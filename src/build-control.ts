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

import * as assert from "assert";
import {
  Arch,
  BuildResult,
  BuildStatusView,
  fetchBuildLog,
  fetchBuildResults,
  fetchJobStatus,
  PackageStatusCode,
  zip
} from "open-build-service-api";
import { BasePackage } from "open-build-service-api/lib/package";
import { Logger } from "pino";
import { parse, stringify } from "querystring";
import * as vscode from "vscode";
import { AccountManager } from "./accounts";
import { ConnectionListenerLoggerBase } from "./base-components";
import {
  BookmarkTreeItem,
  isBookmarkedPackageTreeElement
} from "./bookmark-tree-view";
import { cmdPrefix, ignoreFocusOut, URI_AUTHORITY } from "./constants";
import { logAndReportExceptions } from "./decorators";
import { VscodeWindow } from "./dependency-injection";
import { isPackageTreeElement, ProjectTreeItem } from "./project-view";
import { promptUserForPackage } from "./util";

const OBS_BUILD_STATUS_SCHEME = "vscodeObsBuildStatus";
const OBS_BUILD_LOG_SCHEME = "vscodeObsBuildLog";

const cmdId = "BuildControl";

export const SHOW_BUILD_STATUS_COMMAND = `${cmdPrefix}.${cmdId}.showBuildStatus`;

export const OPEN_BUILD_LOG_COMMAND = `${cmdPrefix}.${cmdId}.openBuildLog`;

/**
 * Creates a human readable explanation of the package status code for codes
 * that are not immediately obvious (like [[PackageStatusCode.Succeeded]]). For
 * obvious ones, `undefined` is returned.
 */
function explanationFromPackageStatusCode(
  code: PackageStatusCode
): string | undefined {
  switch (code) {
    case PackageStatusCode.Unresolvable:
      return "The packages' dependencies cannot be resolved";
    case PackageStatusCode.Failed:
      return "The package failed to build, check the log for further details";
    case PackageStatusCode.Broken:
      return "The package's sources are broken";
    case PackageStatusCode.Excluded:
      return "The package or this repository and architecture combination are excluded from being build";
    case PackageStatusCode.Blocked:
      return "Waiting for dependencies to be rebuild";
    case PackageStatusCode.Locked:
      return "The package is not being automatically rebuild";
    case PackageStatusCode.Finished:
      return "The build has just finished";

    case PackageStatusCode.Succeeded:
    case PackageStatusCode.Disabled:
    case PackageStatusCode.Scheduled:
    case PackageStatusCode.Building:
      return undefined;
    default:
      assert(false, `Unexpected package status code ${code}`);
  }
}

function getAllMultibuilds(
  basePackageName: string,
  buildResults: BuildResult[]
): (string | undefined)[] {
  const res: (string | undefined)[] = [];
  buildResults.forEach((br) => {
    for (const pkg of br.packageStatus?.keys() ?? []) {
      if (pkg === basePackageName) {
        res.push(undefined);
      } else {
        const colonInd = pkg.indexOf(":");
        if (colonInd !== -1 && pkg.slice(0, colonInd) === basePackageName) {
          res.push(pkg.slice(colonInd + 1));
        }
      }
    }
  });
  return [...new Set(res).values()];
}

function multiBuildsToPkgNames(
  basePackageName: string,
  multibuilds: (string | undefined)[]
): string[] {
  return multibuilds.map((m) =>
    m === undefined ? basePackageName : `${basePackageName}:${m}`
  );
}

class PackageBuildDisplay {
  public filteredBuildResults: Map<string, BuildResult[]>;
  public foldingRanges: vscode.FoldingRange[] = [];
  public hovers: vscode.Hover[] = [];

  constructor(public readonly pkg: BasePackage, buildResults: BuildResult[]) {
    const multibuilds = getAllMultibuilds(pkg.name, buildResults);

    this.filteredBuildResults = new Map<string, BuildResult[]>();

    multiBuildsToPkgNames(pkg.name, multibuilds).forEach((actualPkgName) => {
      this.filteredBuildResults.set(
        actualPkgName,
        buildResults
          .filter(
            (st) =>
              st.project === pkg.projectName &&
              st.packageStatus?.get(actualPkgName) !== undefined
          )
          .sort((stA, stB) => {
            const repoCmp = stA.repository.localeCompare(stB.repository);
            return repoCmp === 0
              ? stA.arch.toString().localeCompare(stB.arch.toString())
              : repoCmp;
          })
      );
    });
  }

  public format(): string {
    this.foldingRanges = [];
    this.hovers = [];

    const buildResultsFormated: string[] = [];

    for (const [multibuildName, buildresults] of this.filteredBuildResults) {
      const heading = `Build results of ${this.pkg.projectName}/${multibuildName}`;
      const startOfMultibuildPackageLine = buildResultsFormated.length;
      buildResultsFormated.push(heading, "=".repeat(heading.length));

      let lastRepository = "";
      let startOfRepoLine = buildResultsFormated.length;

      for (const buildRes of buildresults) {
        buildResultsFormated.push("");

        if (buildRes.repository !== lastRepository) {
          if (buildResultsFormated.length > startOfRepoLine) {
            this.foldingRanges.push(
              new vscode.FoldingRange(
                startOfRepoLine,
                buildResultsFormated.length - 2,
                vscode.FoldingRangeKind.Region
              )
            );
            startOfRepoLine = buildResultsFormated.length;
          }
          lastRepository = buildRes.repository;

          buildResultsFormated.push(
            lastRepository,
            "-".repeat(lastRepository.length),
            ""
          );
        }

        const startOfArchLine = buildResultsFormated.length;

        const pkgStatus = buildRes.packageStatus?.get(multibuildName);
        assert(pkgStatus !== undefined);
        const { code, details } = pkgStatus;

        const archAndCodeLine = `${buildRes.arch}: ${code}${
          details !== undefined ? ", " + details : ""
        }`;
        const explanation = explanationFromPackageStatusCode(code);
        if (explanation !== undefined) {
          const line = buildResultsFormated.length;
          const startChar = buildRes.arch.length + 2;
          this.hovers.push(
            new vscode.Hover(
              explanation,
              new vscode.Range(line, startChar, line, startChar + code.length)
            )
          );
        }
        buildResultsFormated.push(...archAndCodeLine.split(/\r\n|\r|\n/));
        const binaries = buildRes.binaries?.get(multibuildName);
        if (binaries !== undefined && binaries.length > 0) {
          const startOfBinariesLine = buildResultsFormated.length;
          buildResultsFormated.push(
            "Binaries: ",
            ...binaries.map(
              (bin) => `${bin.filename} ${bin.modifiedTime.toLocaleString()}`
            )
          );
          this.foldingRanges.push(
            new vscode.FoldingRange(
              startOfBinariesLine,
              buildResultsFormated.length - 1,
              vscode.FoldingRangeKind.Region
            )
          );
        }

        this.foldingRanges.push(
          new vscode.FoldingRange(
            startOfArchLine,
            buildResultsFormated.length - 1,
            vscode.FoldingRangeKind.Region
          )
        );
      }

      // push a folding range for the last repository
      this.foldingRanges.push(
        new vscode.FoldingRange(
          startOfRepoLine,
          buildResultsFormated.length - 1,
          vscode.FoldingRangeKind.Region
        )
      );

      this.foldingRanges.push(
        new vscode.FoldingRange(
          startOfMultibuildPackageLine,
          buildResultsFormated.length - 1,
          vscode.FoldingRangeKind.Region
        )
      );

      // add newlines after each multibuild package
      buildResultsFormated.push("", "");
    }

    const lastTwo = [buildResultsFormated.pop(), buildResultsFormated.pop()];
    assert(lastTwo[0] === "" && lastTwo[1] === "");

    return buildResultsFormated.join("\n");
  }
}

interface PackageRepoArch extends BasePackage {
  readonly repository: string;
  readonly arch: Arch;
  readonly multibuildName?: string;
}

interface PkgBuildLog {
  log: string;
  running: boolean;
  deletionTimeout: NodeJS.Timeout;
  finishedTime?: Date;
}

export class BuildLogDisplay
  extends ConnectionListenerLoggerBase
  implements vscode.TextDocumentContentProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this.onDidChangeEmitter.event;

  private readonly logMap = new Map<string, PkgBuildLog>();

  private static getKeyFromUri(uri: vscode.Uri): string {
    assert(
      uri.authority === URI_AUTHORITY && uri.scheme === OBS_BUILD_LOG_SCHEME
    );
    return `${uri.path}/${uri.query}`;
  }

  private getLogFromMap(uri: vscode.Uri): undefined | string {
    return this.logMap.get(BuildLogDisplay.getKeyFromUri(uri))?.log;
  }

  private setFinishedLogInMap(uri: vscode.Uri, log: string): void {
    const key = BuildLogDisplay.getKeyFromUri(uri);
    const deletionTimeout = this.logMap.get(key)?.deletionTimeout;
    if (deletionTimeout !== undefined) {
      deletionTimeout.refresh();
    }
    this.logMap.set(key, {
      log,
      running: false,
      finishedTime: new Date(),
      deletionTimeout:
        deletionTimeout ??
        setTimeout(this.deletionCallback, 300 * 1000, uri, this)
    });
  }

  // FIXME: enable this eventually
  // private cleanupLogMap(): void {
  //   let mapSize = 0;
  //   for (const buildLog of this.logMap.values()) {
  //     mapSize += buildLog.log.length;
  //   }
  //   if (mapSize)
  // }

  private deleteLogFromMap(uri: vscode.Uri): void {
    const key = BuildLogDisplay.getKeyFromUri(uri);
    const timer = this.logMap.get(key)?.deletionTimeout;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    this.logMap.delete(key);
  }

  public static uriToPkgRepoArch(uri: vscode.Uri): PackageRepoArch {
    if (
      uri.scheme !== OBS_BUILD_LOG_SCHEME ||
      uri.authority !== URI_AUTHORITY
    ) {
      throw new Error(
        `got an invalid uri scheme (${uri.scheme}) or an invalid uri authority (${uri.authority})`
      );
    }
    const projNameAndPkgName = (uri.path[0] === "/"
      ? uri.path.slice(1)
      : uri.path
    ).split("/");
    if (projNameAndPkgName.length !== 2) {
      throw new Error(`got an invalid uri path ${uri.path}`);
    }
    const parsedQuery = parse(uri.query);
    [parsedQuery.apiUrl, parsedQuery.repository, parsedQuery.arch].forEach(
      (opt) => {
        if (opt === undefined || Array.isArray(opt)) {
          throw new Error(`Invalid query string ${uri.query}`);
        }
      }
    );

    if (
      parsedQuery.multibuildName !== undefined &&
      Array.isArray(parsedQuery.multibuildName)
    ) {
      throw new Error(`Invalid query string ${uri.query}`);
    }

    return {
      apiUrl: parsedQuery.apiUrl as string,
      projectName: projNameAndPkgName[0],
      name: projNameAndPkgName[1],
      repository: parsedQuery.repository! as string,
      arch: parsedQuery.arch! as Arch,
      multibuildName: parsedQuery.multibuildName
    };
  }

  public static pkgRepoArchToUri(pkgRepoArch: PackageRepoArch): vscode.Uri {
    const { repository, arch, apiUrl, multibuildName } = pkgRepoArch;
    const queryPart = { repository, apiUrl, arch };
    const query = stringify(
      multibuildName === undefined
        ? queryPart
        : { multibuildName, ...queryPart }
    );
    return vscode.Uri.parse(
      `${OBS_BUILD_LOG_SCHEME}://${URI_AUTHORITY}/${pkgRepoArch.projectName}/${pkgRepoArch.name}?${query}`
    );
  }

  constructor(
    accountManager: AccountManager,
    logger: Logger,
    private readonly vscodeWindow: VscodeWindow = vscode.window
  ) {
    super(accountManager, logger);
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(
        OBS_BUILD_LOG_SCHEME,
        this
      ),
      vscode.commands.registerCommand(
        OPEN_BUILD_LOG_COMMAND,
        this.openBuildLog,
        this
      )
    );
  }

  private deletionCallback(uri: vscode.Uri): void {
    this.logMap.delete(BuildLogDisplay.getKeyFromUri(uri));
  }

  private async fetchLogForPkg(
    uri: vscode.Uri,
    {
      forceRefresh,
      token
    }: { forceRefresh?: boolean; token?: vscode.CancellationToken } = {
      forceRefresh: false
    }
  ): Promise<void> {
    const pkgRepoArch = BuildLogDisplay.uriToPkgRepoArch(uri);
    const hasUri = this.logMap.has(BuildLogDisplay.getKeyFromUri(uri));
    if (!hasUri || !!forceRefresh) {
      const multibuildName = pkgRepoArch.multibuildName;
      const con = this.activeAccounts.getConfig(pkgRepoArch.apiUrl)?.connection;
      if (con === undefined) {
        throw new Error(
          `no valid account found for the API ${pkgRepoArch.apiUrl}`
        );
      }
      const jobStatus = await fetchJobStatus(
        con,
        pkgRepoArch,
        pkgRepoArch.arch,
        pkgRepoArch.repository,
        multibuildName
      );
      if (token?.isCancellationRequested ?? false) {
        return;
      }

      // no job is running
      if (jobStatus === undefined) {
        const fetchLogPromise = fetchBuildLog(
          con,
          pkgRepoArch,
          pkgRepoArch.arch,
          pkgRepoArch.repository,
          { noStream: true, multibuildName }
        );
        if (!hasUri) {
          this.setFinishedLogInMap(uri, await fetchLogPromise);
        } else if (forceRefresh) {
          fetchLogPromise
            .then((log) => {
              this.setFinishedLogInMap(uri, log);
            })
            .catch((reason) => {
              this.logger.error(
                "Fetching the build log of %s/%s for the repository %s & architecture %s asynchronously failed with %s",
                pkgRepoArch.projectName,
                pkgRepoArch.name,
                pkgRepoArch.repository,
                pkgRepoArch.arch,
                reason
              );
            });
        }
      } else {
        this.logMap.set(BuildLogDisplay.getKeyFromUri(uri), {
          log: "",
          running: true,
          deletionTimeout: setTimeout(
            this.deletionCallback,
            300 * 1000,
            uri,
            this
          )
        });
        let log = "";
        fetchBuildLog(
          con,
          pkgRepoArch,
          pkgRepoArch.arch,
          pkgRepoArch.repository,
          {
            noStream: false,
            multibuildName,
            streamCallback: function (this: BuildLogDisplay, logChunk) {
              if (!token?.isCancellationRequested) {
                log = log.concat(logChunk.toString());

                const key = BuildLogDisplay.getKeyFromUri(uri);
                const deletionTimeout = this.logMap.get(key)!.deletionTimeout;
                deletionTimeout.refresh();
                this.logMap.set(key, {
                  log,
                  running: true,
                  deletionTimeout
                });
                this.onDidChangeEmitter.fire(uri);
              }
            },
            streamCallbackThisArg: this
          }
        )
          .then((log) => {
            this.setFinishedLogInMap(uri, log);
          })
          .catch((reason) => {
            this.logger.error(
              "Fetching the build log of %s/%s for the repository %s & architecture %s asynchronously failed with %s",
              pkgRepoArch.projectName,
              pkgRepoArch.name,
              pkgRepoArch.repository,
              pkgRepoArch.arch,
              reason
            );
          });
      }
    }
  }

  @logAndReportExceptions(true)
  public async openBuildLog(
    element?: BookmarkTreeItem,
    pkgRepoArch?: PackageRepoArch
  ): Promise<void> {
    let pkg: BasePackage;
    if (
      element === undefined ||
      (!isPackageTreeElement(element) &&
        !isBookmarkedPackageTreeElement(element))
    ) {
      this.logger.debug(
        "openBuildLog called without an element or one that isn't a PackageTreeElement"
      );
      const usersPkg = await promptUserForPackage(
        this.activeAccounts,
        this.vscodeWindow
      );
      if (usersPkg === undefined) {
        this.logger.error(
          "User was asked to provide a package but they did not do so"
        );
        return;
      }
      pkg = usersPkg;
    } else {
      pkg = {
        apiUrl: element.parentProject.apiUrl,
        name: element.packageName,
        projectName: element.parentProject.name
      };
    }

    const con = this.activeAccounts.getConfig(pkg.apiUrl)?.connection;

    let uri: vscode.Uri;

    if (pkgRepoArch === undefined) {
      if (con === undefined) {
        throw new Error(
          `No valid account is configured for the API ${pkg.apiUrl}`
        );
      }

      let repository: string | undefined = undefined;
      let arch: Arch | undefined = undefined;
      let multibuildName: string | undefined = undefined;

      const buildRes = await fetchBuildResults(con, pkg.projectName, {
        packages: [pkg],
        views: [BuildStatusView.Status],
        multiBuild: true
      });

      if (buildRes.length === 0) {
        throw new Error(
          `Cannot display a log, no build results exist for the package ${pkg.projectName}/${pkg.name}`
        );
      }

      const multibuilds = getAllMultibuilds(pkg.name, buildRes);
      if (multibuilds.length > 1) {
        multibuildName = (
          await this.vscodeWindow.showQuickPick(
            zip(multiBuildsToPkgNames(pkg.name, multibuilds), multibuilds).map(
              ([fullName, multibuild]) => ({
                label: fullName,
                multibuild
              })
            ),
            {
              canPickMany: false,
              ignoreFocusOut,
              placeHolder:
                "Select a the multibuild name for which the build log should be fetched"
            }
          )
        )?.multibuild;
      }

      const presentRepos = [...new Set(buildRes.map((br) => br.repository))];

      repository = await this.vscodeWindow.showQuickPick(presentRepos, {
        canPickMany: false,
        ignoreFocusOut,
        placeHolder:
          "Select a repository for which the build log should be fetched"
      });
      if (repository === undefined) {
        this.logger.error("Could not get a repository from the user");
        return;
      }

      const presentArches = [
        ...new Set(
          buildRes
            .filter((br) => br.repository === repository)
            .map((br) => br.arch)
        )
      ];

      arch = (
        await this.vscodeWindow.showQuickPick(
          presentArches.map((arch) => ({ label: arch })),
          {
            canPickMany: false,
            ignoreFocusOut,
            placeHolder:
              "Select the architecture repository for which the build log should be fetched"
          }
        )
      )?.label;
      if (arch === undefined) {
        this.logger.error("Could not get a repository from the user");
        return;
      }
      /* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */
      assert(repository !== undefined && arch !== undefined);
      uri = BuildLogDisplay.pkgRepoArchToUri({
        ...pkg,
        repository,
        arch,
        multibuildName
      });
    } else {
      const { arch, repository, multibuildName } = pkgRepoArch;
      uri = BuildLogDisplay.pkgRepoArchToUri({
        ...pkg,
        repository,
        arch,
        multibuildName
      });
    }

    await this.fetchLogForPkg(uri, { forceRefresh: false });

    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  public async provideTextDocumentContent(
    uri: vscode.Uri,
    token: vscode.CancellationToken
  ): Promise<string | undefined> {
    await this.fetchLogForPkg(uri, { token });
    return this.getLogFromMap(uri);
  }
}

const BUILD_STATUS_SCHEME_SELECTOR = { scheme: OBS_BUILD_STATUS_SCHEME };

export class BuildStatusDisplay
  extends ConnectionListenerLoggerBase
  implements
    vscode.TextDocumentContentProvider,
    vscode.FoldingRangeProvider,
    vscode.HoverProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this.onDidChangeEmitter.event;

  public static uriToPackageName(uri: vscode.Uri): BasePackage {
    if (
      uri.scheme !== OBS_BUILD_STATUS_SCHEME ||
      uri.authority !== URI_AUTHORITY
    ) {
      throw new Error(
        `got an invalid uri scheme (${uri.scheme}) or an invalid uri authority`
      );
    }
    const projNameAndPkgName = (uri.path[0] === "/"
      ? uri.path.slice(1)
      : uri.path
    ).split("/");
    if (projNameAndPkgName.length !== 2) {
      throw new Error(`got an invalid uri path ${uri.path}`);
    }
    return {
      apiUrl: uri.query,
      projectName: projNameAndPkgName[0],
      name: projNameAndPkgName[1]
    };
  }

  public static packageToUri(pkg: BasePackage): vscode.Uri {
    return vscode.Uri.parse(
      `${OBS_BUILD_STATUS_SCHEME}://${URI_AUTHORITY}/${pkg.projectName}/${pkg.name}?${pkg.apiUrl}`
    );
  }

  constructor(
    accountManager: AccountManager,
    logger: Logger,
    private readonly fileMap = new Map<string, PackageBuildDisplay>(),
    private readonly vscodeWindow: VscodeWindow = vscode.window
  ) {
    super(accountManager, logger);

    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(
        OBS_BUILD_STATUS_SCHEME,
        this
      ),
      vscode.commands.registerCommand(
        SHOW_BUILD_STATUS_COMMAND,
        this.showBuildStatus,
        this
      ),
      vscode.languages.registerFoldingRangeProvider(
        BUILD_STATUS_SCHEME_SELECTOR,
        this
      ),
      vscode.languages.registerHoverProvider(BUILD_STATUS_SCHEME_SELECTOR, this)
    );
  }

  private static uriToKey(uri: vscode.Uri): string {
    assert(
      uri.scheme === OBS_BUILD_STATUS_SCHEME && uri.authority === URI_AUTHORITY
    );
    return `${uri.path}/${uri.query}`;
  }

  private getFileFromFileMap(uri: vscode.Uri): PackageBuildDisplay | undefined {
    return this.fileMap.get(BuildStatusDisplay.uriToKey(uri));
  }

  private insertFileIntoFileMap(
    uri: vscode.Uri,
    packageBuildDisplay: PackageBuildDisplay
  ): void {
    this.fileMap.set(BuildStatusDisplay.uriToKey(uri), packageBuildDisplay);
  }

  private async fetchBuildResultForUri(
    uri: vscode.Uri,
    asyncUpdate: boolean,
    pkg: BasePackage
  ): Promise<void> {
    const uriInMap = this.fileMap.has(BuildStatusDisplay.uriToKey(uri));
    if (!uriInMap || asyncUpdate) {
      const con = this.activeAccounts.getConfig(pkg.apiUrl)?.connection;
      if (con === undefined) {
        throw new Error(
          `cannot show the build results of the package ${pkg.name} because there is no account available for the API ${pkg.apiUrl}`
        );
      }
      const buildResultsPromise = fetchBuildResults(con, pkg.projectName, {
        packages: [pkg],
        views: [BuildStatusView.Status, BuildStatusView.BinaryList],
        multiBuild: true
      });

      if (!uriInMap) {
        const buildResults = await buildResultsPromise;
        this.insertFileIntoFileMap(
          uri,
          new PackageBuildDisplay(pkg, buildResults)
        );
      } else if (asyncUpdate) {
        buildResultsPromise
          .then((buildResults) => {
            this.insertFileIntoFileMap(
              uri,
              new PackageBuildDisplay(pkg, buildResults)
            );
            this.onDidChangeEmitter.fire(uri);
          })
          .catch((reason) => {
            this.logger.error(
              "Fetching the build results of %s/%s asynchronously failed with %s",
              pkg.projectName,
              pkg.name,
              reason
            );
          });
      }
    }
  }

  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Hover | undefined {
    const pkgBuildDisplay = this.getFileFromFileMap(document.uri);
    return pkgBuildDisplay === undefined
      ? undefined
      : pkgBuildDisplay.hovers.find((hover) => hover.range?.contains(position));
  }

  @logAndReportExceptions(true)
  public async showBuildStatus(element?: ProjectTreeItem): Promise<void> {
    let pkg: BasePackage;
    if (
      element === undefined ||
      (!isPackageTreeElement(element) &&
        !isBookmarkedPackageTreeElement(element))
    ) {
      this.logger.debug(
        "showBuildStatus called without an element or one that isn't a PackageTreeElement"
      );
      const usersPkg = await promptUserForPackage(
        this.activeAccounts,
        this.vscodeWindow
      );
      if (usersPkg === undefined) {
        this.logger.error(
          "User was asked to provide a package but they did not do so"
        );
        return;
      }
      pkg = usersPkg;
    } else {
      pkg = {
        apiUrl: element.parentProject.apiUrl,
        name: element.packageName,
        projectName: element.parentProject.name
      };
    }

    const uri = BuildStatusDisplay.packageToUri(pkg);
    await this.fetchBuildResultForUri(uri, true, pkg);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    let pkgBuildDisplay = this.getFileFromFileMap(uri);
    if (pkgBuildDisplay === undefined) {
      await this.fetchBuildResultForUri(
        uri,
        false,
        BuildStatusDisplay.uriToPackageName(uri)
      );
      pkgBuildDisplay = this.getFileFromFileMap(uri);
    }
    assert(pkgBuildDisplay !== undefined);
    return pkgBuildDisplay.format();
  }

  public provideFoldingRanges(
    document: vscode.TextDocument
  ): vscode.FoldingRange[] | undefined {
    const pkgBuildDisplay = this.getFileFromFileMap(document.uri);
    return pkgBuildDisplay === undefined
      ? undefined
      : pkgBuildDisplay.foldingRanges;
  }
}
