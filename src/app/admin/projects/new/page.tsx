import type { Metadata } from "next";
import { createProjectAction } from "@/lib/actions/projects";
import { Field, Flash, PageTitle, inputClass, primaryButtonClass } from "@/components/ui";

export const metadata: Metadata = { title: "New project" };

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const flash = await searchParams;
  return (
    <div className="max-w-2xl">
      <PageTitle
        eyebrow="Registry"
        title="New project"
        lede="Name the woodland, the methodology, and the standard or registry reference. Documents can be added now or later."
      />
      <Flash error={flash.error} />
      <form action={createProjectAction} className="space-y-4 rounded-2xl border border-line bg-white p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project code">
            <input className={inputClass} name="code" placeholder="GLEN" required />
          </Field>
          <Field label="Name">
            <input className={inputClass} name="name" required />
          </Field>
        </div>
        <Field label="Location">
          <input className={inputClass} name="location" placeholder="Glenmalure, Co. Wicklow, Ireland" required />
        </Field>
        <Field label="Methodology">
          <input className={inputClass} name="methodology" required />
        </Field>
        <Field label="Standard or registry reference">
          <input className={inputClass} name="standardReference" required />
        </Field>
        <Field label="Description">
          <textarea className={inputClass} name="description" rows={5} required />
        </Field>
        <Field label="Supporting documents">
          <input className={inputClass} name="documents" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv" />
        </Field>
        <button className={primaryButtonClass} type="submit">
          Create project
        </button>
      </form>
    </div>
  );
}
