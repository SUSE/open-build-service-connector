import { promises as fsPromises } from "fs";
import { join } from "path";
import { Memento } from "vscode";

/**
 * Returns the difference `setA - setB` (all elements from A that are not in B).
 */
export function setDifference<T>(setA: Set<T>, setB: Set<T>): Set<T> {
  const difference: Set<T> = new Set();
  setA.forEach(val => {
    if (!setB.has(val)) {
      difference.add(val);
    }
  });

  return difference;
}

/**
 * Given a Map that was stored in the memento under the key `storageKey` as an
 * array of Tuples of the type `[K, T]`, this function constructs the Map and
 * returns it.
 *
 * This function is the inverse of [[saveMapToMemento]].
 *
 * @param memento  The
 *     [Memento](https://code.visualstudio.com/api/references/vscode-api#Memento)
 *     from which the Map should be constructed.
 *
 * @param storageKey  The key under which the Map's data have been saved.
 *
 * @return  The Map that has been saved by [[saveMapToMemento]].
 */
export function loadMapFromMemento<K, T>(
  memento: Memento,
  storageKey: string
): Map<K, T> {
  return new Map(memento.get<Array<[K, T]>>(storageKey, []));
}

/**
 * Save the Map `map` to the given `memento` as an array of Tuples of type `[K, T]`.
 */
export async function saveMapToMemento<K, T>(
  memento: Memento,
  storageKey: string,
  map: Map<K, T>
): Promise<void> {
  await memento.update(storageKey, [...map.entries()]);
}

/** Remove the directory `dir` recursively */
export async function rmRf(dir: string): Promise<void> {
  const dentries = await fsPromises.readdir(dir, { withFileTypes: true });

  await Promise.all(
    dentries.map(async dentry => {
      if (dentry.isFile()) {
        await fsPromises.unlink(join(dir, dentry.name));
      } else if (dentry.isDirectory()) {
        await rmRf(join(dir, dentry.name));
        await fsPromises.rmdir(join(dir, dentry.name));
      }
    })
  );
}
