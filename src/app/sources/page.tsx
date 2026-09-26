import { redirect } from "next/navigation";

/** Sources moved to Products › Sources; old links keep working. */
export default function OldSourcesPage() {
  redirect("/products?tab=sources");
}
