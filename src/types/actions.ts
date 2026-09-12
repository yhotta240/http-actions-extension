export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ActionContext = "page" | "selection" | "link" | "image" | "video" | "audio";
export type MediaContext = Extract<ActionContext, "video" | "audio">;

export interface TriggerCondition {
  target: "url" | "domain" | "title";
  operator: "equals" | "contains" | "startsWith" | "endsWith" | "matches";
  value: string;
}

export type ActionTrigger =
  | { type: "contextMenu"; contexts: ActionContext[] }
  | { type: "pageLoad"; conditions: TriggerCondition[] };

export type ActionInputType = "text" | "password";

export interface ActionInput {
  key: string;
  type: ActionInputType;
  required: boolean;
}

export interface HttpAction {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs?: number;
  inputs?: ActionInput[];
  triggers: ActionTrigger[];
  enabled: boolean;
  order: number;
}

export type Variables = Record<string, string>;
export type Secrets = Record<string, string>;

export interface ExecutionPageContext {
  url?: string;
  title?: string;
  domain?: string;
  selection?: string;
  linkUrl?: string;
  imageUrl?: string;
  videoUrl?: string;
  videoDirectUrl?: string;
  audioUrl?: string;
  audioDirectUrl?: string;
}

export interface ExecutionResult {
  actionId: string;
  actionName: string;
  success: boolean;
  statusCode?: number;
  statusText?: string;
  responseBody?: string;
  responseHeaders?: Record<string, string>;
  error?: string;
  timestamp: string;
}

export interface ExecutionInputRequired {
  inputRequired: true;
  requestId: string;
  actionName: string;
}
