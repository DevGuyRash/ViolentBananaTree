
export function byRole(
  root: ParentNode,
  role: string,
  name?: string
): HTMLElement | null {
  let selector = `[role=\"${role}\"]`;
  if (name) {
    selector += `[aria-label=\"${name}\"]`;
  }
  return root.querySelector(selector);
}

export function byText(
  root: ParentNode,
  text: string,
  exact: boolean = false
): HTMLElement | null {
  const xpath = exact
    ? `.//descendant-or-self::*[text()="${text}"]`
    : `.//descendant-or-self::*[contains(text(), "${text}")]`;
  const result = document.evaluate(
    xpath,
    root,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  );
  return result.singleNodeValue as HTMLElement | null;
}

export function byDataAttr(
  root: ParentNode,
  key: string,
  value?: string
): HTMLElement | null {
  let selector = `[${key}]`;
  if (value) {
    selector += `="${value}"`;
  }
  return root.querySelector(selector);
}

