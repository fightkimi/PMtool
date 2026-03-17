export function detectCycle(nodes: string[], edges: Map<string, string[]>): string[] | null {
  const colors = new Map<string, 'white' | 'gray' | 'black'>();
  const stack: string[] = [];

  for (const node of nodes) {
    colors.set(node, 'white');
  }

  const visit = (node: string): string[] | null => {
    colors.set(node, 'gray');
    stack.push(node);

    for (const dependency of edges.get(node) ?? []) {
      if (!colors.has(dependency)) {
        colors.set(dependency, 'white');
      }

      const color = colors.get(dependency);
      if (color === 'gray') {
        const startIndex = stack.indexOf(dependency);
        return [...stack.slice(startIndex), dependency];
      }

      if (color !== 'black') {
        const cycle = visit(dependency);
        if (cycle) {
          return cycle;
        }
      }
    }

    stack.pop();
    colors.set(node, 'black');
    return null;
  };

  for (const node of nodes) {
    if (colors.get(node) === 'white') {
      const cycle = visit(node);
      if (cycle) {
        return cycle;
      }
    }
  }

  return null;
}
