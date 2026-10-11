import type { VCommand } from "./parser";

export type GameValue =
  null | string | number | boolean | GameValue[] | { [key: string]: GameValue };
export type GameOrigin = "user" | "ai" | "option";
export type GameScope = "global" | "page" | "event";
export interface GamePage {
  id: string;
  title: string;
  text: string;
  summary: string;
  persistent: boolean;
  created: number;
  parent?: string;
}
export interface GameSection {
  min: number;
  max: number;
  includeMax: boolean;
  result: VCommand[];
}
export interface GameObject {
  id: string;
  name: string;
  kind: string;
  type:
    | "number"
    | "integer"
    | "boolean"
    | "string"
    | "percentage"
    | "value"
    | "enum"
    | "list"
    | "object";
  value: GameValue;
  default: GameValue;
  min?: number;
  max?: number;
  choices?: string[];
  description: string;
  descriptionAI: string;
  descriptionNoAI: string;
  scope: string;
  persistent: boolean;
  aiAccess: "none" | "read" | "modify";
  owner: "user" | "ai";
  sectionMode?: "apart" | "stack";
  sections?: GameSection[];
  baseChance?: number;
  cooldown?: number;
  lastTriggered?: number;
  conditions?: VCommand[];
  onTrigger?: VCommand[];
  onTriggerOwner?: "user" | "ai";
  conditionMode?: "all" | "any";
}
export interface GameWidget {
  id: string;
  label: string;
  binding: string;
  style: "counter" | "progress-bar" | "text" | "badge";
  ui: GameScope;
  panel?: string;
  pageId?: string;
  eventId?: string;
  position: "page-top" | "page-bottom" | "inline";
  visible: boolean;
  removeOn: "never" | "page-exit" | "event-end";
  expiresAfter?: number;
  createdTurn: number;
  owner: "user" | "ai";
}
export interface GamePanel {
  id: string;
  name: string;
  ui: GameScope;
  pageId?: string;
  eventId?: string;
  drawer: "left" | "right";
  position: "page-top" | "page-bottom" | "inline";
  visible: boolean;
  owner: "user" | "ai";
}
export interface GameOption {
  id: string;
  name: string;
  description: string;
  pageId: string;
  order: number;
  group: string;
  once: boolean;
  used: boolean;
  resolved?: boolean;
  result: VCommand[];
  conditions: VCommand[];
  disabledIf: VCommand[];
  owner: "user" | "ai";
}
export interface GameInstruction {
  id: string;
  content: string;
  scope: "global" | "scene" | "entity" | "event";
  target?: string;
  pageId?: string;
  enabled: boolean;
  priority: number;
  owner: "user" | "ai";
}
export interface GameEvent {
  id: string;
  objectId: string;
  active: boolean;
  started?: number;
  ended?: number;
}
export interface GameRule {
  id: string;
  hook: string;
  every?: number;
  result: VCommand[];
  conditions: VCommand[];
  owner: "user" | "ai";
}
export interface GameSettings {
  maxOutputTokens: number;
  thinking: boolean;
  thinkingLevel: "minimal" | "low" | "medium" | "high";
  thinkingMaxTokens: number;
  approval: "manual" | "smart" | "auto";
  profile: "novel" | "balanced" | "interactive" | "designer";
  maxContextTokens: number;
  maxHistoryPages: number;
  reserveTokens: number;
  summary: "manual" | "disabled";
  globalDrawerOpen: boolean;
  choiceNewPage?: boolean;
  generationNewPage?: boolean;
}
export interface GameChange {
  path: (string | number)[];
  before?: unknown;
  after?: unknown;
  text?: { keep: number; tail: number; before: string; after: string };
}
export interface GameRevision {
  proposalIds?: string[];
  id: string;
  at: number;
  label: string;
  origin: GameOrigin;
  changes: GameChange[];
}
export interface GameLogEntry {
  id: string;
  at: number;
  message: string;
}
export interface GameProposal {
  id: string;
  source: string;
  reason: string;
  dependencies: string[];
  status: "pending" | "approved" | "rejected" | "failed";
  error?: string;
  created: number;
  changes: GameChange[];
}
export interface GameProject {
  version: 1;
  id: string;
  pages: GamePage[];
  activePageId: string;
  navigation: string[];
  objects: GameObject[];
  widgets: GameWidget[];
  panels: GamePanel[];
  options: GameOption[];
  instructions: GameInstruction[];
  events: GameEvent[];
  rules: GameRule[];
  proposals: GameProposal[];
  settings: GameSettings;
  history: GameRevision[];
  future: GameRevision[];
  log: GameLogEntry[];
  random: { seed: number; counter: number };
  turn: number;
  elapsedMinutes: number;
  actionLock?: { optionId: string; requestId: string };
}
export interface GameGeneration {
  id: string;
  instruction: string;
  mode: "continue" | "react" | "describe";
}
export interface GameExecution {
  requiresConfirmation?: boolean;
  project: GameProject;
  generation?: GameGeneration;
  diff: GameChange[];
  warnings: string[];
}
export interface GameExecutionOptions {
  origin?: GameOrigin;
  confirmed?: boolean;
  definitionMode?: boolean;
  recordHistory?: boolean;
  label?: string;
  approved?: boolean;
}
