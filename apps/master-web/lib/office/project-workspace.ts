import { createAiProject, getAiProject, updateAiProject } from "@/lib/db/ai-projects";
import { upsertProjectFile } from "@/lib/db/project-files";
import { appendOfficeEvent } from "@/lib/db/office";
import { startPmProject } from "@/lib/office/project-orchestrator";
import {
  outreachCsvTemplate,
  outreachMailDraft,
  outreachReadme,
  type OutreachIntent,
} from "@/lib/office/outreach-intent";

export function scaffoldOutreachProject(
  intent: OutreachIntent,
  facilitatorAgentId: string,
): {
  projectId: string;
  rootTaskId: string;
  files: string[];
  reply: string;
} {
  const started = startPmProject({
    brief: intent.brief,
    title: intent.title,
    facilitatorAgentId,
  });

  const files = [
    upsertProjectFile({
      projectId: started.project.id,
      path: "README.md",
      content: outreachReadme(intent),
      mime: "text/markdown",
    }),
    upsertProjectFile({
      projectId: started.project.id,
      path: "prospects.csv",
      content: outreachCsvTemplate(intent),
      mime: "text/csv",
    }),
    upsertProjectFile({
      projectId: started.project.id,
      path: "mail-draft.txt",
      content: outreachMailDraft(intent),
      mime: "text/plain",
    }),
  ];

  updateAiProject(started.project.id, {
    meta: {
      ...(getAiProject(started.project.id)?.meta ?? {}),
      outreach: {
        kind: intent.kind,
        zone: intent.zone,
        files: files.map((f) => f.path),
      },
      workspace: true,
    },
  });

  const reply = [
    started.reply,
    "",
    "Workspace prêt :",
    ...files.map((f) => `· ${f.path}`),
    "",
    "Réponds « ok go » pour lancer l’équipe. Le CSV et le mail sont éditables dans Projets.",
  ].join("\n");

  appendOfficeEvent(facilitatorAgentId, "agent_message", {
    text: reply,
    role: "agent",
    projectId: started.project.id,
    pmOrchestration: true,
    workspace: true,
  });

  return {
    projectId: started.project.id,
    rootTaskId: started.rootTask.id,
    files: files.map((f) => f.path),
    reply,
  };
}

/** Crée un projet workspace vide (sans PM) pour dépôt de fichiers. */
export function createWorkspaceProject(opts: {
  title: string;
  brief?: string;
  agentId?: string;
}) {
  return createAiProject({
    title: opts.title.slice(0, 160),
    kind: "punctual",
    status: "active",
    brief: opts.brief ?? "",
    agentId: opts.agentId ?? "openclaw:office",
    meta: { workspace: true },
  });
}
