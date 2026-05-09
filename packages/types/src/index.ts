export type UIElementKind = "choice" | "menu" | "item" | "custom";

export type UIElement = {
  id: string;
  kind: UIElementKind;
  label: string;
  hint?: string;
};

export type StoryFrame = {
  id: string;
  narration?: string;
  speaker?: string;
  line?: string;
  scenePrompt: string;
  uiElements: UIElement[];
};

export type ClickIntent = {
  targetId: string | null;
  targetLabel: string | null;
  reasoning: string;
  freeformAction?: string;
};

export type HistoryEntry = {
  frame: StoryFrame;
  click?: { x: number; y: number };
  intent?: ClickIntent;
};

export type Session = {
  id: string;
  createdAt: number;
  worldSetting: string;
  styleGuide: string;
  history: HistoryEntry[];
};

export type ProviderConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type EngineConfig = {
  text: ProviderConfig;
  image: ProviderConfig;
  vision: ProviderConfig;
};

export type StartRequest = {
  worldSetting: string;
  styleGuide: string;
};

export type StartResponse = {
  sessionId: string;
  frame: StoryFrame;
  imageBase64: string;
};

export type InteractRequest = {
  session: Session;
  prevImageBase64: string;
  click: { x: number; y: number };
};

export type InteractResponse = {
  session: Session;
  frame: StoryFrame;
  imageBase64: string;
  intent: ClickIntent;
};
