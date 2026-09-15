import BookModel from "../../models/Book";
import { readingProgressStore } from "../../core/ports/stores";

export function handlePercentage(percentage: number) {
  return { type: "HANDLE_PERCENTAGE", payload: percentage };
}
export function handleFetchPercentage(book: BookModel) {
  return (dispatch: (arg0: { type: string; payload: any }) => void) => {
    const location = readingProgressStore.getProgressSync(book.key);
    let percentage = (location?.percentage as any) || 0;

    dispatch(handlePercentage(percentage));
  };
}
