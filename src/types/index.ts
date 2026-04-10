import type {
  Workspace,
  Project,
  Task,
  TaskExecution,
  TaskMessage,
  TaskLabel,
  Label,
  Repository,
  AgentConfig,
} from "@prisma/client";

export type TaskWithRelations = Task & {
  executions: TaskExecution[];
  messages: TaskMessage[];
};

export type ProjectWithRelations = Project & {
  tasks: Task[];
  repositories: Repository[];
};

export type WorkspaceWithProjects = Workspace & {
  projects: ProjectWithRelations[];
};

export type TaskWithLabels = Task & {
  labels: (TaskLabel & { label: Label })[];
};

export type BoardColumn = {
  id: Task["status"];
  label: string;
  color: string;
  tasks: Task[];
};
