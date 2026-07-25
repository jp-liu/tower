import type {
  Workspace,
  Project,
  Task,
  TaskExecution,
  TaskMessage,
  TaskLabel,
  Label,
  Repository,
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

export type TaskVersionRef = { id: string; number: string; name: string } | null;

export type TaskWithLabels = Task & {
  labels: (TaskLabel & { label: Label })[];
  /** Present when the query includes the version relation (board, etc.) */
  version?: TaskVersionRef;
  /** Present when the query includes execution counts for board actions. */
  _count?: { executions: number };
};

export type BoardColumn = {
  id: Task["status"];
  label: string;
  color: string;
  tasks: Task[];
};
