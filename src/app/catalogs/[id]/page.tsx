import { notFound, redirect } from "next/navigation";

/** The catalog moved to Products (a family page); old links keep working. */
export default async function OldCatalogPage({ params }: PageProps<"/catalogs/[id]">) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  redirect(`/products/${id}`);
}
