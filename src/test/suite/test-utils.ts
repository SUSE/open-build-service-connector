import { should, use } from "chai";
import * as chaiAsPromised from "chai-as-promised";
import * as chaiThings from "chai-things";
import * as pino from "pino";
import * as vscode from "vscode";

use(chaiThings);
use(chaiAsPromised);
should();

export const logger = pino(
  { level: "trace" },
  pino.destination("./logfile.json")
);

export async function waitForEvent<T>(
  event: vscode.Event<T>
): Promise<vscode.Disposable> {
  return new Promise(resolve => {
    const disposable = event(_ => {
      resolve(disposable);
    });
  });
}

export async function executeAndWaitForEvent<T, ET>(
  func: () => Thenable<T>,
  event: vscode.Event<ET>
): Promise<T> {
  const [res, disposable] = await Promise.all([func(), waitForEvent(event)]);
  disposable.dispose();
  return res;
}
