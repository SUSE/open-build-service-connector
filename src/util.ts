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
