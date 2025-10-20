import type { SelectorStrategy } from "../../selectors/types";

export type QueryRoot = Document | DocumentFragment | Element | ShadowRoot;

function toRoot(root?: QueryRoot | null): QueryRoot {
  if (root) {
    return root;
  }

  if (typeof document !== "undefined") {
    return document;
  }

  throw new Error("No document available to resolve selectors");
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeValue(value: string, caseSensitive?: boolean, normalizeWhitespaceFlag?: boolean): string {
  let result = normalizeWhitespaceFlag === false ? value.trim() : collapseWhitespace(value);
  if (!caseSensitive) {
    result = result.toLowerCase();
  }
  return result;
}

function getTextContent(element: Element | null | undefined): string {
  return element?.textContent ?? "";
}

function resolveLabels(element: Element): string[] {
  const labels: string[] = [];
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) {
    labels.push(ariaLabel);
  }

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/).filter(Boolean);
    ids.forEach((id) => {
      const owner = element.ownerDocument?.getElementById(id);
      if (owner) {
        labels.push(getTextContent(owner));
      }
    });
  }

  if ("labels" in element && Array.isArray((element as HTMLInputElement).labels)) {
    const htmlElement = element as HTMLInputElement;
    if (htmlElement.labels) {
      Array.from(htmlElement.labels).forEach((labelNode) => {
        labels.push(getTextContent(labelNode));
      });
    }
  }

  const title = element.getAttribute("title");
  if (title) {
    labels.push(title);
  }

  if (element.textContent) {
    labels.push(element.textContent);
  }

  return labels
    .map((label) => collapseWhitespace(label))
    .filter((label) => label.length > 0);
}

function matchesAccessibleName(
  element: Element,
  expected: string,
  options?: { caseSensitive?: boolean }
): boolean {
  const labels = resolveLabels(element);
  const target = options?.caseSensitive ? expected.trim() : expected.trim().toLowerCase();

  return labels.some((label) => {
    const current = options?.caseSensitive ? label : label.toLowerCase();
    return current === target;
  });
}

function findAll(root: QueryRoot): Element[] {
  return Array.from(root.querySelectorAll("*"));
}

function executeRoleStrategy(strategy: SelectorStrategy, root: QueryRoot): Element[] {
  if (strategy.type !== "role") {
    return [];
  }

  const selector = `[role="${strategy.role}"]`;
  const nodes = toRoot(root).querySelectorAll(selector);
  const candidates = Array.from(nodes);

  return candidates.filter((element) => {
    const nameMatches = strategy.name
      ? matchesAccessibleName(element, strategy.name)
      : true;
    const labelMatches = strategy.label
      ? matchesAccessibleName(element, strategy.label)
      : true;
    const textMatches = strategy.text
      ? collapseWhitespace(getTextContent(element)).includes(collapseWhitespace(strategy.text))
      : true;

    return nameMatches && labelMatches && textMatches;
  });
}

function executeNameStrategy(strategy: SelectorStrategy, root: QueryRoot): Element[] {
  if (strategy.type !== "name") {
    return [];
  }

  const selector = `[name="${strategy.name}"]`;
  return Array.from(toRoot(root).querySelectorAll(selector));
}

function executeLabelStrategy(strategy: SelectorStrategy, root: QueryRoot): Element[] {
  if (strategy.type !== "label") {
    return [];
  }

  const expected = normalizeValue(strategy.label, strategy.caseSensitive, false);
  const elements = findAll(toRoot(root));

  return elements.filter((element) => {
    const labels = resolveLabels(element).map((value) =>
      normalizeValue(value, strategy.caseSensitive, false)
    );
    return labels.includes(expected);
  });
}

function executeTextStrategy(strategy: SelectorStrategy, root: QueryRoot): Element[] {
  if (strategy.type !== "text") {
    return [];
  }

  const elements = findAll(toRoot(root));
  const expected = normalizeValue(
    strategy.text,
    strategy.caseSensitive,
    strategy.normalizeWhitespace
  );

  return elements.filter((element) => {
    const content = normalizeValue(
      getTextContent(element),
      strategy.caseSensitive,
      strategy.normalizeWhitespace
    );

    if (strategy.exact) {
      return content === expected;
    }

    return content.includes(expected);
  });
}

function executeDataAttrStrategy(strategy: SelectorStrategy, root: QueryRoot): Element[] {
  if (strategy.type !== "dataAttr") {
    return [];
  }

  const attributeSelector = `[${strategy.attribute}]`;
  const nodes = toRoot(root).querySelectorAll(attributeSelector);
  const candidates = Array.from(nodes);

  if (typeof strategy.value === "undefined") {
    return candidates;
  }

  return candidates.filter((element) => element.getAttribute(strategy.attribute) === strategy.value);
}

function executeTestIdStrategy(strategy: SelectorStrategy, root: QueryRoot): Element[] {
  if (strategy.type !== "testId") {
    return [];
  }

  const attribute = strategy.attribute ?? "data-testid";
  const selector = `[${attribute}="${strategy.testId}"]`;
  return Array.from(toRoot(root).querySelectorAll(selector));
}

function executeCssStrategy(strategy: SelectorStrategy, root: QueryRoot): Element[] {
  if (strategy.type !== "css") {
    return [];
  }

  try {
    return Array.from(toRoot(root).querySelectorAll(strategy.selector));
  } catch {
    return [];
  }
}

function executeXpathStrategy(strategy: SelectorStrategy, root: QueryRoot): Element[] {
  if (strategy.type !== "xpath") {
    return [];
  }

  const searchRoot = toRoot(root);
  const doc = searchRoot.ownerDocument ?? (searchRoot as Document);
  try {
    const result = doc.evaluate(
      strategy.expression,
      searchRoot,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );

    const matches: Element[] = [];
    for (let i = 0; i < result.snapshotLength; i += 1) {
      const node = result.snapshotItem(i);
      if (node instanceof Element) {
        matches.push(node);
      }
    }

    return matches;
  } catch {
    return [];
  }
}

export function executeStrategy(strategy: SelectorStrategy, root?: QueryRoot | null): Element[] {
  const resolvedRoot = toRoot(root);

  switch (strategy.type) {
    case "role":
      return executeRoleStrategy(strategy, resolvedRoot);
    case "name":
      return executeNameStrategy(strategy, resolvedRoot);
    case "label":
      return executeLabelStrategy(strategy, resolvedRoot);
    case "text":
      return executeTextStrategy(strategy, resolvedRoot);
    case "dataAttr":
      return executeDataAttrStrategy(strategy, resolvedRoot);
    case "testId":
      return executeTestIdStrategy(strategy, resolvedRoot);
    case "css":
      return executeCssStrategy(strategy, resolvedRoot);
    case "xpath":
      return executeXpathStrategy(strategy, resolvedRoot);
    default:
      return [];
  }
}

