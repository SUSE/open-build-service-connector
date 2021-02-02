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
import {
  Connection,
  fetchProject,
  Package,
  PackageFile,
  Project,
  ProjectMeta
} from "open-build-service-api";

export const enum BookmarkState {
  Ok = 0x0,
  LocalGone = 0x1,
  RemoteGone = 0x2,
  MetadataBroken = 0x4,
  /**
   * The bookmark was created but no test was done to be able to specify the
   * state.
   */
  Unknown = 0x8
}

function isValidBookmarkState(state: number): boolean {
  // prettier-ignore
  return (
    (state &
      (BookmarkState.Ok |
        BookmarkState.RemoteGone |
        BookmarkState.RemoteGone |
        BookmarkState.MetadataBroken |
        BookmarkState.MetadataBroken)
    ) === 0
  );
}

export interface PackageBookmark extends Omit<Package, "files"> {
  readonly checkoutPath?: string;

  readonly state: number;

  files?: PackageFile[];
}

export class PackageBookmarkImpl implements PackageBookmark {
  public readonly apiUrl: string;
  public readonly name: string;
  public readonly projectName: string;
  public readonly state: number;
  public readonly files?: PackageFile[];

  constructor(apiUrl: string, name: string, projectName: string, state: number);
  constructor(pkg: Package, state?: BookmarkState);

  constructor(
    apiUrlOrPkg: string | Package,
    nameOrState: string | BookmarkState | undefined,
    projectName?: string,
    state?: number
  ) {
    if (typeof apiUrlOrPkg === "string") {
      assert(
        typeof nameOrState === "string" &&
          projectName !== undefined &&
          state !== undefined
      );
      this.apiUrl = apiUrlOrPkg;
      this.name = nameOrState;
      this.projectName = projectName;
      this.state = state;
    } else {
      assert(
        (nameOrState === undefined || typeof nameOrState !== "string") &&
          projectName === undefined &&
          state === undefined
      );
      this.apiUrl = apiUrlOrPkg.apiUrl;
      this.name = apiUrlOrPkg.name;
      this.projectName = apiUrlOrPkg.projectName;
      this.state = nameOrState ?? BookmarkState.Ok;
    }
  }
}

export function packageBookmarkFromPackage(
  pkg: Package,
  checkoutPath?: string
): PackageBookmark {
  return {
    ...pkg,
    state: BookmarkState.Ok,
    checkoutPath
  };
}

export function isPackageBookmark(pkg: any): pkg is PackageBookmark {
  return pkg.state !== undefined && typeof pkg.state === "number";
}

export interface ProjectBookmark extends Omit<Project, "packages"> {
  /**
   * If this project is checked out, then this is the canonical location where
   * it can be found.
   */
  readonly checkoutPath?: string;

  /** If true, then the bookmark is broken (e.g. project got deleted). */
  readonly state: number;

  packages?: PackageBookmark[];
}

export class ProjectBookmarkImpl implements ProjectBookmark {
  public readonly name: string;
  public readonly apiUrl: string;
  public readonly packages?: PackageBookmark[];
  public readonly state: number;
  public readonly checkoutPath?: string;
  public readonly meta?: ProjectMeta;

  static async createProjectBookmark(
    con: Connection,
    project: Project
  ): Promise<ProjectBookmark> {
    try {
      const proj = await fetchProject(con, project.name, {
        fetchPackageList: true
      });
      return new ProjectBookmarkImpl(proj, BookmarkState.Ok);
    } catch {
      return new ProjectBookmarkImpl(project, BookmarkState.RemoteGone);
    }
  }

  constructor(
    name: string,
    apiUrl: string,
    state: number,
    checkoutPath: string,
    packages?: PackageBookmark[],
    meta?: ProjectMeta
  );
  constructor(proj: Project, state?: BookmarkState);

  constructor(
    projOrName: Project | string,
    apiUrlOrState: BookmarkState | string | undefined,
    state?: number,
    checkoutPath?: string,
    packages?: PackageBookmark[],
    meta?: ProjectMeta
  ) {
    assert(
      (typeof projOrName === "string") === (typeof apiUrlOrState === "string")
    );
    if (typeof projOrName === "string") {
      assert(
        typeof apiUrlOrState === "string" &&
          state !== undefined &&
          isValidBookmarkState(state)
      );
      this.name = projOrName;
      this.apiUrl = apiUrlOrState;
      this.state = state;
      this.checkoutPath = checkoutPath;
      this.packages = packages;
      this.meta = meta;
    } else {
      assert(
        state === undefined &&
          checkoutPath === undefined &&
          packages === undefined &&
          meta === undefined &&
          typeof apiUrlOrState !== "string" &&
          (apiUrlOrState === undefined || isValidBookmarkState(apiUrlOrState))
      );
      this.name = projOrName.name;
      this.apiUrl = projOrName.apiUrl;
      this.state = apiUrlOrState ?? BookmarkState.Ok;
      this.packages = projOrName.packages?.map((p) =>
        packageBookmarkFromPackage(p)
      );
      this.meta = projOrName.meta;
    }
    assert(isValidBookmarkState(this.state));
  }
}

export function projectBookmarkFromProject(
  proj: Project,
  state: BookmarkState = BookmarkState.Ok
): ProjectBookmark {
  const { packages, ...rest } = proj;
  return {
    ...rest,
    state,
    packages: packages?.map((pkg) => packageBookmarkFromPackage(pkg))
  };
}

export function isLocalGone(state: number): boolean {
  return (state & BookmarkState.LocalGone) === BookmarkState.LocalGone;
}

export function isRemoteGone(state: number): boolean {
  return (state & BookmarkState.RemoteGone) === BookmarkState.RemoteGone;
}
export function isMetadataBroken(state: number): boolean {
  return (
    (state & BookmarkState.MetadataBroken) === BookmarkState.MetadataBroken
  );
}

export function isProjectBookmark(proj: any): proj is ProjectBookmark {
  return proj.state !== undefined && typeof proj.state === "number";
}
