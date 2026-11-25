import { notFound } from "next/navigation";
import { FEATURES, type DevFeature } from "./features";
import { Showcase } from "./showcases";

/** Dev-only gallery: every state of every feature, on mock data (no API needed). */
export default async function Page({ params }: PageProps<"/dev/[feature]">) {
  if (process.env.NODE_ENV === "production") notFound();
  const { feature } = await params;
  if (!(FEATURES as readonly string[]).includes(feature)) notFound();
  return <Showcase feature={feature as DevFeature} />;
}
