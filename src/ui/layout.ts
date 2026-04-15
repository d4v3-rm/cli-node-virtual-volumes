export interface LayoutPositionSpec {
  width?: number | string;
  left?: number | string;
  right?: number | string;
}

export interface LayoutElementSpec {
  position?: LayoutPositionSpec;
  parent?: unknown;
}

export const resolveLayoutValue = (
  size: number | string | undefined,
  parentWidth: number,
  fallbackValue: number,
): number => {
  if (typeof size === 'number') {
    return size;
  }

  if (typeof size !== 'string') {
    return fallbackValue;
  }

  const trimmed = size.trim();
  if (trimmed.length === 0) {
    return fallbackValue;
  }

  if (trimmed === 'half') {
    return Math.floor(parentWidth * 0.5);
  }

  if (trimmed === 'center') {
    return 0;
  }

  const expressionParts = trimmed.split(/(?=[+-])/);
  const baseValue = expressionParts[0] ?? '';
  const deltaValue =
    expressionParts.length > 1
      ? Number.parseInt(expressionParts.slice(1).join(''), 10)
      : 0;
  const delta = Number.isNaN(deltaValue) ? 0 : deltaValue;

  if (baseValue.endsWith('%')) {
    const percentage = Number.parseFloat(baseValue.slice(0, -1));
    if (!Number.isNaN(percentage)) {
      return Math.floor(parentWidth * (percentage / 100)) + delta;
    }
  }

  const absolute = Number.parseInt(baseValue, 10);
  if (!Number.isNaN(absolute)) {
    return absolute + delta;
  }

  return fallbackValue;
};

export const resolveParentWidth = (parent: unknown, fallbackWidth: number): number => {
  if (!parent || typeof parent !== 'object') {
    return fallbackWidth;
  }

  const candidateParent = parent as LayoutElementSpec;

  if (!candidateParent.position) {
    return fallbackWidth;
  }

  return resolveElementOuterWidth(candidateParent, fallbackWidth);
};

export const resolveElementOuterWidth = (
  element: LayoutElementSpec,
  fallbackParentWidth: number,
): number => {
  const parentWidth = resolveParentWidth(element.parent, fallbackParentWidth);
  const width = element.position?.width;

  if (width !== undefined && width !== null) {
    return resolveLayoutValue(width, parentWidth, parentWidth);
  }

  const left = resolveLayoutValue(element.position?.left, parentWidth, 0);
  const right = resolveLayoutValue(element.position?.right, parentWidth, 0);
  return Math.max(0, parentWidth - left - right);
};

export const getContentWidth = (
  element: LayoutElementSpec,
  fallbackParentWidth: number,
): number => Math.max(20, resolveElementOuterWidth(element, fallbackParentWidth) - 4);
