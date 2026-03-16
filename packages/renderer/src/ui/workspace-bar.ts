const shortenPath = (p: string): string => {
  const home = '~';
  return p.replace(/^\/Users\/[^/]+/, home);
};

const container = () => document.getElementById('workspace-bar')!;

export const setWorkspace = (path: string): void => {
  container().textContent = shortenPath(path);
};
