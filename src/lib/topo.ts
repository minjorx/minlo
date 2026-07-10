// Topological sort over ability deps.
//
// Given a list of AbilityRecord (each with a `deps: string[]` field),
// produce a linear order such that for any edge A → B in `A.deps`, B comes
// before A in the order. Use Kahn's algorithm (BFS on in-degree).
//
// Errors (all throw — caller aborts the run):
//   - Any dep references an unknown name → DependencyNotFoundError
//   - Any cycle exists (A.deps contains B and B.deps contains A, etc.) →
//     CyclicDependencyError
import type { AbilityRecord } from './loader.js';

export class DependencyNotFoundError extends Error {
  constructor(public readonly dep: string, public readonly from: string) {
    super(`ability "${from}" depends on unknown ability "${dep}"`);
    this.name = 'DependencyNotFoundError';
  }
}

export class CyclicDependencyError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`cyclic dependency: ${cycle.join(' → ')}`);
    this.name = 'CyclicDependencyError';
  }
}

export function topoSort(records: AbilityRecord[]): AbilityRecord[] {
  const byName = new Map(records.map((r) => [r.name, r]));

  // Validate all deps reference known abilities
  for (const r of records) {
    for (const dep of r.deps) {
      if (!byName.has(dep)) {
        throw new DependencyNotFoundError(dep, r.name);
      }
    }
  }

  // Build in-degree + adjacency (dep → dependents)
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const r of records) {
    inDegree.set(r.name, 0);
    adj.set(r.name, []);
  }
  for (const r of records) {
    for (const dep of r.deps) {
      adj.get(dep)!.push(r.name);
      inDegree.set(r.name, (inDegree.get(r.name) ?? 0) + 1);
    }
  }

  // Kahn's: enqueue nodes with in-degree 0
  const queue: string[] = [];
  for (const [name, deg] of inDegree) {
    if (deg === 0) queue.push(name);
  }

  const order: AbilityRecord[] = [];
  while (queue.length > 0) {
    // Stable order: sort to make output deterministic
    queue.sort();
    const name = queue.shift()!;
    order.push(byName.get(name)!);
    for (const dependent of adj.get(name) ?? []) {
      const newDeg = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, newDeg);
      if (newDeg === 0) queue.push(dependent);
    }
  }

  if (order.length !== records.length) {
    // Collect remaining nodes (those with non-zero in-degree) for diagnostic
    const remaining: string[] = [];
    for (const [name, deg] of inDegree) {
      if (deg > 0) remaining.push(name);
    }
    throw new CyclicDependencyError(remaining);
  }

  return order;
}
