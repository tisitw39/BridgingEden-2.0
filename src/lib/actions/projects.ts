"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { saveDocuments } from "@/lib/documents";
import { errorMessage, flashRedirect, isRedirectError } from "@/lib/http";
import { requireAdmin } from "@/lib/session";

const projectSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Use a project code of 2–8 letters or numbers.")
    .max(8, "Use a project code of 2–8 letters or numbers.")
    .regex(/^[A-Za-z0-9]+$/, "Use a project code of 2–8 letters or numbers.")
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(3, "Name the project.").max(120),
  location: z.string().trim().min(3, "Add a location.").max(160),
  methodology: z.string().trim().min(3, "Add a methodology.").max(200),
  standardReference: z.string().trim().min(3, "Add the standard or registry reference.").max(200),
  description: z.string().trim().min(10, "Describe the project.").max(5000),
});

export async function createProjectAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = projectSchema.safeParse({
    code: formData.get("code"),
    name: formData.get("name"),
    location: formData.get("location"),
    methodology: formData.get("methodology"),
    standardReference: formData.get("standardReference"),
    description: formData.get("description"),
  });
  if (!parsed.success) {
    flashRedirect(
      "/admin/projects/new",
      "error",
      parsed.error.issues[0]?.message ?? "Check the form and try again.",
    );
  }

  try {
    const project = await prisma.project.create({
      data: { ...parsed.data, createdById: admin.id },
    });
    await saveDocuments(formData, project.id, admin.id);
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "project.created",
        entityType: "Project",
        entityId: project.id,
        detail: { code: project.code, name: project.name },
      },
    });
    flashRedirect(`/admin/projects/${project.id}`, "notice", "Project created.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    flashRedirect("/admin/projects/new", "error", errorMessage(error, "The project could not be created."));
  }
}

export async function uploadDocumentsAction(formData: FormData) {
  const admin = await requireAdmin();
  const projectId = String(formData.get("projectId") ?? "");
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) flashRedirect("/admin/projects", "error", "Project not found.");
  try {
    await saveDocuments(formData, projectId, admin.id);
    flashRedirect(`/admin/projects/${projectId}`, "notice", "Documents added.");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    flashRedirect(
      `/admin/projects/${projectId}`,
      "error",
      errorMessage(error, "The documents could not be uploaded."),
    );
  }
}
