import { cancelJob, createJob, pauseJob, resumePausedJob } from "@/lib/db/jobs";
import { appendOfficeEvent, cancelQueuedOfficeCommands, enqueueOfficeCommand, getAggregatedOfficeAgent, getOfficeCommand, hasLiveOfficeCommand, jobsForOfficeAgent, officeSources, parseOfficeAgentId, upsertOfficeAgent } from "@/lib/db/office";
import { appendAgentLog } from "@/lib/db/agent-logs";
import { getDb } from "@/lib/db/sqlite";
import { logSecurityEvent } from "@/lib/security-log";
import { buildMessageMemory } from "@/lib/office/memory";
import { createMissionTask, looksLikeMission } from "@/lib/office/handoff";
import { getAgentProfile } from "@/lib/db/agent-profiles";
import {
  createAiProject,
  deleteAiProject,
  getAiProject,
  listAiProjects,
  updateAiProject,
} from "@/lib/db/ai-projects";
import type { OfficeAgent, OfficeCommandKind } from "@/lib/office/types";
import type { PipelineJob } from "@/lib/types";
import { matchProjectByTitle, parseProjectSpeech } from "@/lib/office/project-intent";
import {
  deliverMeetingStatusToChat,
  parseMeetingStatusQuery,
  startAllHandsMeeting,
} from "@/lib/office/meeting";
import { parseMeetingIntent } from "@/lib/office/meeting-intent";
import {
  isMailConnected,
  parseMailBriefIntent,
  parseMonitorInterval,
  parseWatchSpeechIntent,
} from "@/lib/office/scenario-helpers";
import { loadMailImapConfig } from "@/lib/db/office-secrets";
import { fetchInboxPreview, formatInboxBrief } from "@/lib/office/mail-imap";
import {
  getSetupSession,
  handleSetupMessage,
  parseMailConnectIntent,
  startMailSetup,
} from "@/lib/office/setup-session";
import {
  parsePmCancelProject,
  parsePmPlanGateReply,
  parsePmProjectStart,
  parsePmStatusQuery,
} from "@/lib/office/pm-intent";
import { parseOutreachListIntent } from "@/lib/office/outreach-intent";
import { scaffoldOutreachProject } from "@/lib/office/project-workspace";
import {
  answerBlockedQuestion,
  approveDeliveryGate,
  approvePlan,
  buildPmStatusReply,
  cancelPmProject,
  findProjectAwaitingHuman,
  findProjectAwaitingPlanApproval,
  getActivePmProject,
  rejectPlan,
  revisePlan,
  startPmProject,
} from "@/lib/office/project-orchestrator";

function officeChannelId(): string {
  return "office";
}

function latestPausable(jobs: PipelineJob[]): PipelineJob | undefined {
  return jobs.find((j) => j.status === "queued" || j.status === "claimed" || j.status === "running");
}

function latestPaused(jobs: PipelineJob[]): PipelineJob | undefined {
  return jobs.find((j) => j.status === "paused");
}

function latestStoppable(jobs: PipelineJob[]): PipelineJob | undefined {
  return jobs.find(
    (j) =>
      j.status === "queued" ||
      j.status === "claimed" ||
      j.status === "running" ||
      j.status === "paused" ||
      j.status === "failed",
  );
}

async function logOfficeAction(kind: "office_message" | "office_stop", agent: OfficeAgent, detail: string) {
  await logSecurityEvent({
    kind,
    title: kind === "office_stop" ? `Stop ${agent.name}` : `Message ${agent.name}`,
    detail,
    meta: { agentId: agent.id, agentKind: agent.kind },
  });
}

export type OfficeActionResult = {
  ok: boolean;
  agent: OfficeAgent | null;
  commandId?: string;
  jobId?: string;
  projectId?: string;
  error?: string;
};

export async function dispatchOfficeAction(
  agentId: string,
  kind: OfficeCommandKind,
  payload: Record<string, unknown> = {},
): Promise<OfficeActionResult> {
  const parsed = parseOfficeAgentId(agentId);
  if (!parsed) {
    return { ok: false, agent: null, error: "id invalide" };
  }

  // Carte compacte waiting-queue : cibler le premier job
  if (agentId === "job:waiting-queue") {
    const sources = officeSources();
    const first = sources.waitingJobs[0];
    if (!first) return { ok: false, agent: null, error: "aucun job en attente" };
    return dispatchOfficeAction(`job:${first.id}`, kind, payload);
  }

  const agent = getAggregatedOfficeAgent(agentId);
  if (!agent && parsed.kind !== "openclaw") {
    return { ok: false, agent: null, error: "agent introuvable" };
  }

  const message = typeof payload.text === "string" ? payload.text.trim() : "";

  if (parsed.kind === "openclaw") {
    if (kind === "message" && !message) {
      return { ok: false, agent, error: "message vide" };
    }

    // Statut réunion — réponse factuelle, pas de fast-chat qui invente
    if (kind === "message" && parseMeetingStatusQuery(message)) {
      deliverMeetingStatusToChat(agentId, message);
      upsertOfficeAgent({
        id: agentId,
        kind: "openclaw",
        name: agent?.name ?? parsed.rest,
        status: "idle",
        task: "statut réunion",
        currentAction: null,
        lastSeenAt: new Date().toISOString(),
        meta: { ...(agent?.meta ?? {}) },
      });
      return { ok: true, agent: getAggregatedOfficeAgent(agentId) ?? agent };
    }

    // Setup session multi-tours (mail, …) — avant intents one-shot
    if (kind === "message" && message) {
      const activeSetup = getSetupSession(agentId);
      if (activeSetup) {
        const handled = await handleSetupMessage(agentId, message);
        if (handled.handled) {
          if (handled.launchMail) {
            return dispatchOfficeAction(agentId, "message", {
              text:
                handled.launchMail === "triage"
                  ? "trie mon inbox"
                  : "analyse ma boîte mail",
              _fromSetup: true,
            });
          }
          return { ok: true, agent: getAggregatedOfficeAgent(agentId) ?? agent };
        }
      }
    }

    // Réunion all-hands AVANT PM (évite qu’un brief « réunion… » parte en projet)
    if (kind === "message" && message && parseMeetingIntent(message)) {
      const task = startAllHandsMeeting({
        brief: message,
        facilitatorAgentId: agentId,
      });
      const n = Array.isArray(task.meta.participants) ? (task.meta.participants as unknown[]).length : 0;
      appendOfficeEvent(agentId, "user_message", { text: message, role: "user" });
      appendOfficeEvent(agentId, "agent_message", {
        text: `Réunion lancée — j’interroge ${n} agents (Chef, Mgr Dev, Mgr Lab, Main). Je reviens avec la synthèse quand tout le monde a répondu.`,
        role: "agent",
        meeting: true,
        taskId: task.id,
      });
      appendAgentLog(agentId, "reflection", `Réunion lancée · ${n} agents consultés · tâche ${task.id.slice(0, 8)}`, {
        taskId: task.id,
        meeting: true,
      });
      upsertOfficeAgent({
        id: agentId,
        kind: "openclaw",
        name: agent?.name ?? parsed.rest,
        status: "working",
        task: task.title.slice(0, 80),
        currentAction: "réunion",
        lastSeenAt: new Date().toISOString(),
        meta: { ...(agent?.meta ?? {}), meetingTaskId: task.id, pendingCommand: "meeting" },
      });
      return { ok: true, agent: getAggregatedOfficeAgent(agentId) ?? agent };
    }

    // --- Orchestration PM (déterministe) ---
    if (kind === "message" && message) {
      const cancelIntent = parsePmCancelProject(message);
      if (cancelIntent) {
        const r = cancelPmProject({ titleQuery: cancelIntent.titleQuery });
        upsertOfficeAgent({
          id: agentId,
          kind: "openclaw",
          name: agent?.name ?? parsed.rest,
          status: "idle",
          task: r.ok ? "projet annulé" : null,
          currentAction: null,
          lastSeenAt: new Date().toISOString(),
          meta: { ...(agent?.meta ?? {}) },
        });
        if (!r.ok) {
          appendOfficeEvent(agentId, "agent_message", {
            text: r.reply,
            role: "agent",
            pmOrchestration: true,
          });
        }
        return { ok: true, agent: getAggregatedOfficeAgent(agentId) ?? agent };
      }

      if (parsePmStatusQuery(message) && getActivePmProject()) {
        const reply = buildPmStatusReply(agentId);
        if (reply) {
          appendOfficeEvent(agentId, "user_message", { text: message, role: "user" });
          appendOfficeEvent(agentId, "agent_message", {
            text: reply,
            role: "agent",
            pmOrchestration: true,
          });
          return { ok: true, agent: getAggregatedOfficeAgent(agentId) ?? agent };
        }
      }

      const awaitingPlan = findProjectAwaitingPlanApproval();
      if (awaitingPlan) {
        const gate = parsePmPlanGateReply(message);
        if (gate === "approve") {
          appendOfficeEvent(agentId, "user_message", { text: message, role: "user" });
          approvePlan(awaitingPlan.id);
          return { ok: true, agent: getAggregatedOfficeAgent(agentId) ?? agent };
        }
        if (gate === "reject") {
          appendOfficeEvent(agentId, "user_message", { text: message, role: "user" });
          rejectPlan(awaitingPlan.id, message);
          return { ok: true, agent: getAggregatedOfficeAgent(agentId) ?? agent };
        }
        if (gate === "revise") {
          appendOfficeEvent(agentId, "user_message", { text: message, role: "user" });
          revisePlan(awaitingPlan.id, message);
          return { ok: true, agent: getAggregatedOfficeAgent(agentId) ?? agent };
        }
      }

      const awaitingHuman = findProjectAwaitingHuman();
      if (awaitingHuman) {
        const orchPhase = (awaitingHuman.meta.orchestration as { phase?: string } | undefined)?.phase;
        const gate = parsePmPlanGateReply(message);
        if (orchPhase === "awaiting_delivery_approval" && gate === "approve") {
          appendOfficeEvent(agentId, "user_message", { text: message, role: "user" });
          approveDeliveryGate(awaitingHuman.id);
          return { ok: true, agent: getAggregatedOfficeAgent(agentId) ?? agent };
        }
        // Toute réponse non vide débloque une question (PM-09)
        appendOfficeEvent(agentId, "user_message", { text: message, role: "user" });
        answerBlockedQuestion(awaitingHuman.id, message);
        return { ok: true, agent: getAggregatedOfficeAgent(agentId) ?? agent };
      }

      // Outreach commerces sans site → workspace CSV + mail + plan PM
      const outreach = parseOutreachListIntent(message);
      if (outreach) {
        const built = scaffoldOutreachProject(outreach, agentId);
        upsertOfficeAgent({
          id: agentId,
          kind: "openclaw",
          name: agent?.name ?? parsed.rest,
          status: "waiting",
          task: `Plan · ${outreach.title}`.slice(0, 80),
          currentAction: "attente validation plan",
          lastSeenAt: new Date().toISOString(),
          meta: {
            ...(agent?.meta ?? {}),
            pmProjectId: built.projectId,
            pendingCommand: "pm-plan",
          },
        });
        return {
          ok: true,
          agent: getAggregatedOfficeAgent(agentId) ?? agent,
          projectId: built.projectId,
        };
      }

      const pmStart = parsePmProjectStart(message);
      if (pmStart) {
        const started = startPmProject({
          brief: pmStart.brief,
          title: pmStart.title,
          facilitatorAgentId: agentId,
        });
        upsertOfficeAgent({
          id: agentId,
          kind: "openclaw",
          name: agent?.name ?? parsed.rest,
          status: "waiting",
          task: `Plan · ${started.project.title}`.slice(0, 80),
          currentAction: "attente validation plan",
          lastSeenAt: new Date().toISOString(),
          meta: {
            ...(agent?.meta ?? {}),
            pmProjectId: started.project.id,
            pendingCommand: "pm-plan",
          },
        });
        return { ok: true, agent: getAggregatedOfficeAgent(agentId) ?? agent };
      }
    }

    // CRUD projet via langage naturel (avant veille / mission / LLM)
    if (kind === "message" && message) {
      const intent = parseProjectSpeech(message);
      if (intent) {
        let note = "";
        if (intent.kind === "create") {
          const watch = parseWatchSpeechIntent(message);
          const interval = parseMonitorInterval(message);
          const nowIso = new Date().toISOString();
          const project = createAiProject({
            title: intent.title,
            kind: watch || interval ? "recurring" : intent.projectKind,
            schedule: interval
              ? `toutes les ${interval.minutes} min`
              : intent.schedule ?? null,
            brief: intent.brief ?? message,
            notes: intent.notes ?? "",
            status: "active",
            agentId,
            nextRunAt: watch || interval ? nowIso : null,
            meta: watch
              ? {
                  watchType: "sentinel",
                  intervalMinutes: watch.interval.minutes,
                  product: watch.brief.product,
                  maxPriceEur: watch.brief.maxPriceEur,
                  sites: watch.brief.sites,
                  category: watch.brief.category,
                }
              : interval
                ? { watchType: "sentinel", intervalMinutes: interval.minutes }
                : {},
          });
          note = watch
            ? `Sentinelle créée « ${project.title} » (${project.schedule}) · id ${project.id.slice(0, 8)}`
            : `Projet créé « ${project.title} » (${project.kind}) · id ${project.id.slice(0, 8)}`;
        } else if (intent.kind === "update") {
          const hit = matchProjectByTitle(listAiProjects(), intent.titleQuery);
          if (!hit) {
            note = `Projet introuvable pour « ${intent.titleQuery} »`;
          } else {
            const project = updateAiProject(hit.id, intent.patch);
            note = `Projet « ${project?.title ?? hit.title} » mis à jour`;
          }
        } else if (intent.kind === "delete") {
          const hit = matchProjectByTitle(listAiProjects(), intent.titleQuery);
          if (!hit) {
            note = `Projet introuvable pour « ${intent.titleQuery} »`;
          } else {
            deleteAiProject(hit.id);
            note = `Projet « ${hit.title} » supprimé`;
          }
        }
        appendOfficeEvent(agentId, "user_message", {
          text: message,
          role: "user",
        });
        appendOfficeEvent(agentId, "system", {
          text: note,
          role: "system",
          projectSpeech: true,
        });
        // Accusé court sans mission longue
        const cmd = enqueueOfficeCommand(agentId, "message", {
          text: `L'humain a dit: ${message}\n\nConfirme brièvement: ${note}`,
          projectSpeech: true,
        });
        upsertOfficeAgent({
          id: agentId,
          kind: "openclaw",
          name: agent?.name ?? parsed.rest,
          status: "working",
          task: note.slice(0, 80),
          currentAction: "projet",
          lastSeenAt: new Date().toISOString(),
          meta: { ...(agent?.meta ?? {}), pendingCommand: "message" },
        });
        return { ok: true, agent: getAggregatedOfficeAgent(agentId) ?? agent, commandId: cmd.id };
      }
    }

    // Veille produit / sentinelle sans mot « projet »
    if (kind === "message" && message) {
      const watch = parseWatchSpeechIntent(message);
      if (watch) {
        const nowIso = new Date().toISOString();
        const project = createAiProject({
          title: watch.title,
          kind: "recurring",
          schedule: watch.schedule,
          brief: message,
          status: "active",
          agentId: "openclaw:mgr-dev",
          nextRunAt: nowIso,
          meta: {
            watchType: "sentinel",
            intervalMinutes: watch.interval.minutes,
            product: watch.brief.product,
            maxPriceEur: watch.brief.maxPriceEur,
            sites: watch.brief.sites,
            category: watch.brief.category,
          },
        });
        const note = `Sentinelle créée « ${project.title} » · ${watch.schedule} · id ${project.id.slice(0, 8)}`;
        appendOfficeEvent(agentId, "user_message", { text: message, role: "user" });
        appendOfficeEvent(agentId, "system", {
          text: note,
          role: "system",
          projectSpeech: true,
          sentinel: true,
        });
        upsertOfficeAgent({
          id: agentId,
          kind: "openclaw",
          name: agent?.name ?? parsed.rest,
          status: "working",
          task: note.slice(0, 80),
          currentAction: "sentinelle",
          lastSeenAt: new Date().toISOString(),
          meta: { ...(agent?.meta ?? {}), pendingCommand: "message" },
        });
        return { ok: true, agent: getAggregatedOfficeAgent(agentId) ?? agent };
      }
    }

    // Analyse / tri mail — wizard si non branché, sinon fetch IMAP + Lab
    if (kind === "message" && (parseMailBriefIntent(message) || parseMailConnectIntent(message))) {
      const mailIntent = parseMailBriefIntent(message);
      const connectOnly = parseMailConnectIntent(message) && !mailIntent;
      const connected = isMailConnected();

      if (!connected && !payload._fromSetup) {
        const started = startMailSetup(agentId, mailIntent?.action ?? (connectOnly ? null : "analyze"));
        appendOfficeEvent(agentId, "user_message", { text: message, role: "user" });
        appendOfficeEvent(agentId, "agent_message", {
          text: started.reply,
          role: "agent",
          setup: true,
        });
        return { ok: true, agent: getAggregatedOfficeAgent(agentId) ?? agent };
      }

      if (connectOnly && connected) {
        appendOfficeEvent(agentId, "user_message", { text: message, role: "user" });
        appendOfficeEvent(agentId, "agent_message", {
          text: "La boîte mail est déjà branchée. Dis « analyse ma boîte mail » pour lancer une lecture.",
          role: "agent",
        });
        return { ok: true, agent: getAggregatedOfficeAgent(agentId) ?? agent };
      }

      const assignee = "openclaw:mgr-lab";
      let note = "Analyse mail déléguée au Lab.";
      let mailText = `[Analyse inbox]\n${message}`;

      if (connected) {
        const cfg = loadMailImapConfig();
        if (cfg) {
          const preview = await fetchInboxPreview(cfg, 8);
          if (preview.ok) {
            const brief = formatInboxBrief(preview.messages);
            mailText = [
              "[Analyse inbox — messages réels]",
              `Compte: ${cfg.user} @ ${cfg.host}`,
              "",
              brief,
              "",
              `Demande utilisateur: ${message}`,
              "",
              "Résume urgences, actions suggérées. Français. Pas de markdown lourd.",
            ].join("\n");
            note = `Inbox lue (${preview.messages.length} msgs) → Lab.`;
          } else {
            mailText = `[Analyse mail — erreur IMAP: ${preview.error}]\nBrief: ${message}`;
            note = `IMAP erreur: ${preview.error.slice(0, 80)}`;
          }
        }
      } else {
        note = "Mail non connecté — brief seul.";
        mailText = `[Analyse mail — IMAP non connecté]\nBrief:\n${message}`;
      }

      const cmd = enqueueOfficeCommand(assignee, "message", {
        text: mailText,
        forceOpenClaw: true,
        mailBrief: true,
        mailConnected: connected,
      });
      const task = createMissionTask({
        title: `Mail: ${message.slice(0, 60)}`,
        brief: message,
        assigneeAgentId: assignee,
        commandId: cmd.id,
        multiAgent: false,
      });
      appendOfficeEvent(agentId, "user_message", { text: message, role: "user" });
      appendOfficeEvent(agentId, "system", {
        text: `${note} · tâche ${task.id.slice(0, 8)}`,
        role: "system",
        taskId: task.id,
        mailBrief: true,
      });
      appendOfficeEvent(assignee, "user_message", {
        text: mailText.slice(0, 2000),
        role: "system",
        taskId: task.id,
        handoff: true,
        commandId: cmd.id,
      });
      upsertOfficeAgent({
        id: agentId,
        kind: "openclaw",
        name: agent?.name ?? parsed.rest,
        status: "working",
        task: note.slice(0, 80),
        currentAction: "mail",
        lastSeenAt: new Date().toISOString(),
        meta: { ...(agent?.meta ?? {}), pendingCommand: "message" },
      });
      return { ok: true, agent: getAggregatedOfficeAgent(agentId) ?? agent, commandId: cmd.id };
    }

    // Pause/stop : enqueue pour ack sidecar + statut local, sans LLM obligatoire
    const memory =
      kind === "message" || kind === "resume" ? buildMessageMemory(agentId) : null;
    const persona = getAgentProfile(agentId)?.persona;
    const projectId = typeof payload.projectId === "string" ? payload.projectId : null;
    const project = projectId ? getAiProject(projectId) : null;
    const teamId =
      typeof payload.teamId === "string"
        ? payload.teamId
        : (project?.teamId ?? null);
    const forceTask = payload.createTask === true || Boolean(projectId);
    const cmdPayload = memory
      ? {
          ...payload,
          history: memory.history,
          ...(memory.summary ? { summary: memory.summary } : {}),
          roster: memory.roster,
          ...(persona ? { personaHint: persona.slice(0, 400) } : {}),
          ...(teamId ? { teamId } : {}),
          ...(projectId ? { projectId } : {}),
        }
      : payload;
    const cmd = enqueueOfficeCommand(agentId, kind, cmdPayload);
    appendOfficeEvent(agentId, kind === "message" ? "user_message" : `command_${kind}`, {
      commandId: cmd.id,
      text: message || undefined,
      role: kind === "message" || kind === "resume" ? "user" : "system",
      ...(projectId ? { projectId } : {}),
    });

    if ((kind === "message" || kind === "resume") && message && (forceTask || looksLikeMission(message))) {
      const task = createMissionTask({
        title: (project?.title ? `${project.title}: ` : "") + message.slice(0, 80),
        brief: message,
        assigneeAgentId: agentId,
        commandId: cmd.id,
        projectId,
        teamId,
        multiAgent: Boolean(teamId) || /\b(équipe|equipe|spawn|délègue|delegue|mgr)\b/i.test(message),
      });
      // Relie taskId sur la commande pour le bridge / handoff
      const linked = getOfficeCommand(cmd.id);
      if (linked) {
        getDb()
          .prepare(`UPDATE office_commands SET payload = ?, updated_at = ? WHERE id = ?`)
          .run(
            JSON.stringify({ ...linked.payload, taskId: task.id }),
            new Date().toISOString(),
            cmd.id,
          );
      }
      appendOfficeEvent(agentId, "system", {
        text: `Tâche ouverte (${task.phase}) · ${task.id.slice(0, 8)}`,
        role: "system",
        taskId: task.id,
      });
    }
    if (kind === "pause" || kind === "stop") {
      const cancelled = cancelQueuedOfficeCommands(agentId);
      const liveRun = hasLiveOfficeCommand(agentId);
      const wasWorking = agent?.status === "working";
      const holdWorking = liveRun || wasWorking;
      const meta = { ...(agent?.meta ?? {}) };
      delete meta.pauseRequested;
      delete meta.stopRequested;
      if (kind === "pause") meta.pauseRequested = true;
      if (kind === "stop") meta.stopRequested = true;
      meta.pendingCommand = kind;

      upsertOfficeAgent({
        id: agentId,
        kind: "openclaw",
        name: agent?.name ?? parsed.rest,
        status: holdWorking ? "working" : kind === "stop" ? "idle" : "waiting",
        task: agent?.task ?? (kind === "stop" && !holdWorking ? null : agent?.task ?? "en pause"),
        currentAction: kind === "stop" ? "stop demandé…" : "pause demandée…",
        lastSeenAt: new Date().toISOString(),
        meta,
      });
      appendOfficeEvent(agentId, "system", {
        text: holdWorking
          ? `${kind === "stop" ? "Stop" : "Pause"} demandé — run en cours jusqu'à ack`
          : `${kind === "stop" ? "Stop" : "Pause"} demandé`,
        role: "system",
        commandId: cmd.id,
      });
      if (cancelled > 0) {
        appendOfficeEvent(agentId, "system", {
          text: `${cancelled} message(s) annulé(s) en file`,
          role: "system",
        });
      }
    } else if (kind === "message" || kind === "resume") {
      upsertOfficeAgent({
        id: agentId,
        kind: "openclaw",
        name: agent?.name ?? parsed.rest,
        status: "working",
        task: message || agent?.task || "message",
        currentAction: "message",
        lastSeenAt: new Date().toISOString(),
        meta: { ...(agent?.meta ?? {}), pendingCommand: "message" },
      });
    }
    if (kind === "message") {
      await logOfficeAction(
        "office_message",
        agent ?? ({ id: agentId, name: parsed.rest, kind: "openclaw" } as OfficeAgent),
        message.slice(0, 300),
      );
    }
    if (kind === "stop") {
      await logOfficeAction(
        "office_stop",
        agent ?? ({ id: agentId, name: parsed.rest, kind: "openclaw" } as OfficeAgent),
        "Stop OpenClaw",
      );
    }
    return { ok: true, agent: getAggregatedOfficeAgent(agentId) ?? agent, commandId: cmd.id };
  }

  const jobs = jobsForOfficeAgent(agentId);
  const sources = officeSources();

  if (kind === "message") {
    if (!message) return { ok: false, agent, error: "message vide" };
    const paused = parsed.kind === "job" ? jobs[0] : latestPaused(jobs);
    if (paused?.status === "paused") {
      if (!sources.pc.online) {
        return { ok: false, agent, error: "PC hors ligne — impossible de reprendre le job" };
      }
      const resumed = resumePausedJob(paused.id, message);
      appendOfficeEvent(agentId, "user_message", {
        jobId: paused.id,
        text: message.slice(0, 500),
        role: "user",
      });
      await logOfficeAction("office_message", agent!, message.slice(0, 300));
      return { ok: Boolean(resumed), agent: getAggregatedOfficeAgent(agentId), jobId: paused.id };
    }
    if (!sources.pc.online) {
      return { ok: false, agent, error: "PC hors ligne — impossible de créer un job" };
    }
    const job = createJob({
      target: "agent",
      prompt: message,
      waChatId: officeChannelId(),
      parentJobId: parsed.kind === "job" ? parsed.rest : null,
    });
    appendOfficeEvent(agentId, "user_message", {
      jobId: job.id,
      text: message.slice(0, 500),
      role: "user",
    });
    await logOfficeAction("office_message", agent!, message.slice(0, 300));
    return { ok: true, agent: getAggregatedOfficeAgent(agentId), jobId: job.id };
  }

  if (kind === "pause") {
    const target = parsed.kind === "job" ? jobs[0] : latestPausable(jobs);
    if (!target) return { ok: false, agent, error: "aucun job à mettre en pause" };
    pauseJob(target.id);
    appendOfficeEvent(agentId, "command_pause", { jobId: target.id, role: "system" });
    return { ok: true, agent: getAggregatedOfficeAgent(agentId), jobId: target.id };
  }

  if (kind === "resume") {
    const target = parsed.kind === "job" ? jobs[0] : latestPaused(jobs);
    if (!target || target.status !== "paused") {
      return { ok: false, agent, error: "aucun job en pause" };
    }
    if (!sources.pc.online) {
      return { ok: false, agent, error: "PC hors ligne — impossible de reprendre" };
    }
    const reply = message || "reprendre";
    resumePausedJob(target.id, reply);
    appendOfficeEvent(agentId, "command_resume", { jobId: target.id, text: reply, role: "user" });
    return { ok: true, agent: getAggregatedOfficeAgent(agentId), jobId: target.id };
  }

  const target = parsed.kind === "job" ? jobs[0] : latestStoppable(jobs);
  if (!target) return { ok: false, agent, error: "aucun job à arrêter" };
  cancelJob(target.id, "stop depuis le bureau Master");
  appendOfficeEvent(agentId, "command_stop", { jobId: target.id, role: "system" });
  await logOfficeAction("office_stop", agent!, `Stop job ${target.id}`);
  return { ok: true, agent: getAggregatedOfficeAgent(agentId), jobId: target.id };
}
