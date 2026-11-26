import { notFound } from "next/navigation";
import { EditorShowcase } from "./showcase";

/** Dev-only: the rich-text editor on a fixture document that uses every option. */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <EditorShowcase />;
}
