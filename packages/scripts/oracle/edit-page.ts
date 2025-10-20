import { resolve, SelectorMap } from "@core/resolve";
import * as oracleSelectors from "@selectors/oracle.json";

const selectorMap: SelectorMap = oracleSelectors as unknown as SelectorMap;

export function clickEditAndFocusNotes(): void {
  const editButton = resolve(selectorMap, "edit_button");
  if (editButton) {
    editButton.click();
    const notesField = resolve(selectorMap, "notes_field");
    if (notesField) {
      notesField.focus();
    }
  }
}
