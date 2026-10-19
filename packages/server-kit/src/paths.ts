/** Strip `basePath` from a browser path so it can be given to Next's `redirect()`. */
export function toAppPath(browserPath: string, basePath = ''): string {
  if (!basePath) return browserPath;
  if (browserPath === basePath) return '/';
  if (browserPath.startsWith(`${basePath}/`) || browserPath.startsWith(`${basePath}?`)) {
    const rest = browserPath.slice(basePath.length);
    return rest.startsWith('?') ? `/${rest}` : rest;
  }
  return browserPath;
}
