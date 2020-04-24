# Naming Rules

## Tree Elements

Classes that inherit from
[vscode.TreeItem](https://code.visualstudio.com/api/references/vscode-api#TreeItem)
should be called `XyzTreeElement`.
A union type of multiple of these TreeElement types that belong to a single
[TreeDataProvider](https://code.visualstudio.com/api/references/vscode-api#TreeDataProvider)
should be called `AbcTreeItem`.

For example:
```typescript
export class ProjectTreeElement extends vscode.TreeItem {
  // omitted
}
export class PackageTreeElement extends vscode.TreeItem {
  // omitted
}
export type ProjectTreeItem =
  | ProjectTreeElement
  | PackageTreeElement;
```
