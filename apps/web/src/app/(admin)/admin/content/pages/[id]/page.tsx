import { PageEditor } from "@/features/cms/pages";

export const metadata = { title: "Edit page · Admin · Media" };

export default async function Page({ params }: PageProps<"/admin/content/pages/[id]">) {
  const { id } = await params;
  return <PageEditor id={id} />;
}
