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
