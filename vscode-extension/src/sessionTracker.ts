import * as path from "node:path";
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import {
  postVsCodeSession,
  type VsCodeSessionPayload,
  type VsCodeLanguageDuration,
} from "./api/timelensApi";

interface SessionDraft {
  sessionId: string;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  projectName: string;
  projectPath: string;
  languageDurations: Map<string, number>;
}

export class SessionTracker {
  private readonly pendingQueue: VsCodeSessionPayload[] = [];
  private currentSession: SessionDraft | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private lastActiveAt: Date | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {}

  start(): void {
    this.stop();
    this.tickTimer = setInterval(() => this.onTick(), 1000);
    this.flushTimer = setInterval(() => this.flushPending(), this.flushIntervalMs());
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.finalizeCurrentSession(new Date());
    void this.flushPending();
  }

  async flushNow(): Promise<void> {
    this.finalizeCurrentSession(new Date());
    await this.flushPending();
  }

  getQueueSize(): number {
    return this.pendingQueue.length;
  }

  private onTick(): void {
    const now = new Date();
    const enabled = this.enabled();
    if (!enabled) {
      this.finalizeCurrentSession(now);
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      if (this.lastActiveAt && this.secondsSince(this.lastActiveAt, now) >= this.idleThresholdSeconds()) {
        this.finalizeCurrentSession(this.lastActiveAt);
      }
      return;
    }

    const document = editor.document;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return;
    }

    this.lastActiveAt = now;
    const projectPath = workspaceFolder.uri.fsPath;
    const projectName = path.basename(projectPath) || projectPath;
    const language = document.languageId || "unknown";

    if (!this.currentSession) {
      this.currentSession = this.createSession(now, projectName, projectPath);
    }

    if (this.currentSession.projectPath !== projectPath) {
      this.finalizeCurrentSession(now);
      this.currentSession = this.createSession(now, projectName, projectPath);
    }

    this.currentSession.endedAt = now;
    this.currentSession.durationSeconds += 1;
    if (this.trackingLevel() !== "basic") {
      const current = this.currentSession.languageDurations.get(language) ?? 0;
      this.currentSession.languageDurations.set(language, current + 1);
    }
  }

  private createSession(now: Date, projectName: string, projectPath: string): SessionDraft {
    return {
      sessionId: randomUUID(),
      startedAt: now,
      endedAt: now,
      durationSeconds: 0,
      projectName,
      projectPath,
      languageDurations: new Map<string, number>(),
    };
  }

  private finalizeCurrentSession(endedAt: Date): void {
    if (!this.currentSession) {
      return;
    }

    this.currentSession.endedAt = endedAt;
    if (this.currentSession.durationSeconds <= 0) {
      this.currentSession = null;
      return;
    }

    const level = this.trackingLevel();

    const payload: VsCodeSessionPayload = {
      session_id: this.currentSession.sessionId,
      started_at: this.currentSession.startedAt.toISOString(),
      ended_at: this.currentSession.endedAt.toISOString(),
      duration_seconds: this.currentSession.durationSeconds,
    };

    if (level === "standard" || level === "detailed") {
      const languageDurations: VsCodeLanguageDuration[] = Array.from(
        this.currentSession.languageDurations.entries()
      )
        .map(([language, seconds]) => ({ language, seconds }))
        .filter((item) => item.seconds > 0);
      if (languageDurations.length > 0) {
        payload.language_durations = languageDurations;
      }
    }

    if (level === "detailed") {
      payload.project_name = this.currentSession.projectName;
      payload.project_path = this.currentSession.projectPath;
    }

    this.pendingQueue.push(payload);
    this.currentSession = null;
  }

  private async flushPending(): Promise<void> {
    if (!this.enabled()) {
      this.pendingQueue.length = 0;
      return;
    }

    const apiBaseUrl = this.apiBaseUrl();
    while (this.pendingQueue.length > 0) {
      const head = this.pendingQueue[0];
      try {
        await postVsCodeSession(apiBaseUrl, head);
        this.pendingQueue.shift();
      } catch {
        break;
      }
    }
  }

  private enabled(): boolean {
    return vscode.workspace.getConfiguration("timelens").get<boolean>("enabled", true);
  }

  private apiBaseUrl(): string {
    return vscode.workspace
      .getConfiguration("timelens")
      .get<string>("apiBaseUrl", "http://127.0.0.1:49152");
  }

  private flushIntervalMs(): number {
    const seconds = vscode.workspace
      .getConfiguration("timelens")
      .get<number>("flushIntervalSeconds", 30);
    return Math.max(5, seconds) * 1000;
  }

  private trackingLevel(): "basic" | "standard" | "detailed" {
    return vscode.workspace
      .getConfiguration("timelens")
      .get<"basic" | "standard" | "detailed">("trackingLevel", "standard");
  }

  private idleThresholdSeconds(): number {
    return Math.max(
      30,
      vscode.workspace.getConfiguration("timelens").get<number>("idleThresholdSeconds", 120)
    );
  }

  private secondsSince(start: Date, end: Date): number {
    return Math.floor((end.getTime() - start.getTime()) / 1000);
  }
}
