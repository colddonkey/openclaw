/**
 * Configuration for the multi-agent operating system features.
 *
 * All multi-agent OS features are opt-in. When `enabled` is false (default),
 * the task store, agent identity system, auto task generation, and
 * Telegram/web kanban board are all inactive.
 */

export type MultiAgentOsConfig = {
  /** Master toggle — enables the task store, agent identity, and kanban board. Default: false. */
  enabled?: boolean;

  /** Configuration for automatic task extraction from conversations. */
  autoTasks?: {
    /** Extract tasks from conversation messages. Default: true (when multiAgentOs is enabled). */
    enabled?: boolean;
    /** Only extract explicit tasks (TODO/FIXME/Action items). Disables implicit extraction. */
    explicitOnly?: boolean;
  };

  /** Configuration for the agent identity system (emergent personas). */
  identity?: {
    /** Enable emergent agent personas (traits, skills, stats). Default: true. */
    enabled?: boolean;
    /** Rate at which unused traits decay (0.0-1.0 per day). Default: 0.02. */
    traitDecayRate?: number;
  };

  /** Configuration for the Telegram kanban board. */
  telegram?: {
    /** Show /board and /tasks commands in Telegram. Default: true. */
    enabled?: boolean;
  };

  /** SQLite database path override. Default: ~/.openclaw/tasks/tasks.sqlite */
  dbPath?: string;
};
