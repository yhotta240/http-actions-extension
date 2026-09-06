export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ActionContext = "page" | "selection" | "link" | "image";

export interface HttpAction {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body: string;
  contexts: ActionContext[];
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
}

export interface ExecutionResult {
  actionId: string;
  actionName: string;
  success: boolean;
  statusCode?: number;
  statusText?: string;
  responseBody?: string;
  error?: string;
  timestamp: string;
}
