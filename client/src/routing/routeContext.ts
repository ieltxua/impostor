export type StyleVariant = 'v1' | 'v3';

export interface RouteContext {
  styleVariant: StyleVariant;
  appPath: string;
  basePath: string;
  hasVariantPrefix: boolean;
}

const INVITE_ROOM_CODE_PATTERN = /^[A-Z0-9]{5}$/;

function normalizeBasePath(baseUrl: string): string {
  if (!baseUrl || baseUrl === '/') {
    return '';
  }

  const withLeadingSlash = baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
}

function stripBasePath(pathname: string, basePath: string): string {
  if (!basePath) {
    return pathname;
  }
  if (pathname === basePath) {
    return '/';
  }
  if (pathname.startsWith(`${basePath}/`)) {
    const relativePath = pathname.slice(basePath.length);
    return relativePath || '/';
  }
  return pathname;
}

function joinPath(basePath: string, ...segments: string[]): string {
  const allSegments = [...basePath.split('/').filter(Boolean), ...segments.filter(Boolean)];
  return allSegments.length === 0 ? '/' : `/${allSegments.join('/')}`;
}

function normalizeInviteRoomCode(raw: string | null | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }

  const normalized = raw.trim().toUpperCase();
  return INVITE_ROOM_CODE_PATTERN.test(normalized) ? normalized : undefined;
}

function getInviteCodeFromAppPath(appPath: string): string | undefined {
  const pathSegments = appPath.split('/').filter(Boolean);
  if (pathSegments[0] !== 'join') {
    return undefined;
  }
  return normalizeInviteRoomCode(pathSegments[1]);
}

export function resolveRouteContext(pathname: string, baseUrl: string = import.meta.env.BASE_URL): RouteContext {
  const basePath = normalizeBasePath(baseUrl);
  const normalizedPathname = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const relativePath = stripBasePath(normalizedPathname, basePath);
  const pathSegments = relativePath.split('/').filter(Boolean);
  const maybeVariant = pathSegments[0];
  const hasVariantPrefix = maybeVariant === 'v1' || maybeVariant === 'v3';
  const styleVariant: StyleVariant = hasVariantPrefix ? maybeVariant : 'v1';
  const appSegments = hasVariantPrefix ? pathSegments.slice(1) : pathSegments;
  const appPath = appSegments.length === 0 ? '/' : `/${appSegments.join('/')}`;

  return {
    styleVariant,
    appPath,
    basePath,
    hasVariantPrefix
  };
}

export function buildVariantHref(routeContext: RouteContext, variant: StyleVariant, search: string = ''): string {
  const appSuffix = routeContext.appPath === '/' ? '' : routeContext.appPath;
  return `${joinPath(routeContext.basePath, variant)}${appSuffix}${search}`;
}

export function buildInviteJoinPath(routeContext: RouteContext, roomCode: string): string {
  const normalizedRoomCode = normalizeInviteRoomCode(roomCode) ?? roomCode.trim().toUpperCase();
  if (routeContext.hasVariantPrefix) {
    return joinPath(routeContext.basePath, routeContext.styleVariant, 'join', normalizedRoomCode);
  }
  return joinPath(routeContext.basePath, 'join', normalizedRoomCode);
}

export function resolveInviteRoomCode(pathname: string, search: string, baseUrl: string = import.meta.env.BASE_URL): string | undefined {
  const routeContext = resolveRouteContext(pathname, baseUrl);
  const fromPath = getInviteCodeFromAppPath(routeContext.appPath);
  if (fromPath) {
    return fromPath;
  }
  return normalizeInviteRoomCode(new URLSearchParams(search).get('room'));
}
