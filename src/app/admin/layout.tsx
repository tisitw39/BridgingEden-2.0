import { AdminNav } from "@/components/admin-nav";
import { requireAdmin } from "@/lib/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div>
      <div className="border-b border-line bg-pale">
        <div className="mx-auto max-w-page px-6 py-3 lg:px-8">
          <AdminNav />
        </div>
      </div>
      <div className="mx-auto max-w-page px-6 py-10 lg:px-8">{children}</div>
    </div>
  );
}
