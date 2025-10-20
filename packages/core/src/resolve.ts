import { SelectorMap } from "./locators";
import { byRole, byText, byDataAttr } from "./utils/dom";

export function resolve(
  map: SelectorMap,
  key: string,
  root: ParentNode = document
): HTMLElement | null {
  const definition = map[key];
  if (!definition) {
    console.error(`[DGX] Selector key not found: ${key}`);
    return null;
  }

  let currentRoot = root;
  if (definition.scopeKey) {
    const scopedRoot = resolve(map, definition.scopeKey, root);
    if (!scopedRoot) {
      console.error(
        `[DGX] Scope key not found: ${definition.scopeKey} for key: ${key}`
      );
      return null;
    }
    currentRoot = scopedRoot;
  }

  for (const strategy of definition.tries) {
    let element: HTMLElement | null = null;
    switch (strategy.type) {
      case "role":
        element = byRole(currentRoot, strategy.role, strategy.name);
        break;
      case "text":
        element = byText(currentRoot, strategy.text, strategy.exact);
        break;
      case "dataAttr":
        element = byDataAttr(currentRoot, strategy.key, strategy.value);
        break;
      case "id":
        element = (currentRoot as Document).getElementById(strategy.id);
        break;
      case "css":
        element = currentRoot.querySelector(strategy.css);
        break;
      case "xpath":
        element = document.evaluate(
          strategy.xpath,
          currentRoot,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        ).singleNodeValue as HTMLElement | null;
        break;
    }
    if (element) {
      console.log(
        `[DGX] Resolved key: ${key} with strategy: ${strategy.type}`
      );
      return element;
    }
  }
  console.error(`[DGX] Selector miss for key: ${key}`);
  return null;
}

