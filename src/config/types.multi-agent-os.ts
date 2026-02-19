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

  /** Configuration for the agent communication board. */
  comms?: {
    /** Enable inter-agent messaging and communication channels. Default: true. */
    enabled?: boolean;
    /** Forward agent messages to Telegram. Default: false. */
    telegramForward?: boolean;
    /**
     * Telegram chat/group ID for agent comms forwarding.
     * When set, agent messages go to this group instead of your primary DM.
     * Create a Telegram group, add the bot, and use the group's chat ID here.
     */
    telegramGroupId?: string;
  };

  /** Configuration for the automatic task scheduler. */
  scheduler?: {
    /** Enable the auto-scheduler. Default: true (when multiAgentOs is enabled). */
    enabled?: boolean;
    /** Interval between scheduling runs in milliseconds. Default: 30000. */
    intervalMs?: number;
    /** Max concurrent in-progress tasks per agent. Default: 3. */
    maxConcurrentPerAgent?: number;
    /** Minimum score threshold for assignment (0.0-1.0). Default: 0.1. */
    minScoreThreshold?: number;
    /** Weight for skill match scoring (0.0-1.0). Default: 0.5. */
    skillWeight?: number;
    /** Weight for load balancing scoring (0.0-1.0). Default: 0.3. */
    loadWeight?: number;
    /** Weight for recency scoring (0.0-1.0). Default: 0.2. */
    recencyWeight?: number;
  };

  /** Configuration for the agent autonomy loop (agents work independently). */
  autonomy?: {
    /** Enable autonomous agent loops. Default: false (must be explicitly enabled). */
    enabled?: boolean;
    /** How often each agent's loop ticks, in milliseconds. Default: 10000. */
    tickIntervalMs?: number;
    /** Max consecutive errors before an agent is paused. Default: 5. */
    maxConsecutiveErrors?: number;
    /** Max work cycles per session before forced pause. Default: 100. */
    maxCyclesPerSession?: number;
    /** Cooldown between task completions in ms. Default: 2000. */
    completionCooldownMs?: number;
    /** Agent IDs to activate. Empty = all registered agents. */
    activeAgents?: string[];
  };

  /** SQLite database path override. Default: ~/.openclaw/tasks/tasks.sqlite */
  dbPath?: string;
};
