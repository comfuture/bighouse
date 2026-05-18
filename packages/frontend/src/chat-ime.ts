export interface ChatImeState {
  isComposing: boolean;
  suppressEnterUntil: number;
}

export interface ChatEnterEventLike {
  isComposing?: boolean;
  keyCode?: number;
}

export function createChatImeState(): ChatImeState {
  return { isComposing: false, suppressEnterUntil: 0 };
}

export function markCompositionStart(state: ChatImeState): void {
  state.isComposing = true;
}

export function markCompositionEnd(state: ChatImeState, now = Date.now()): void {
  state.isComposing = false;
  state.suppressEnterUntil = now + 80;
}

export function shouldSubmitChatEnter(event: ChatEnterEventLike, state: ChatImeState, now = Date.now()): boolean {
  return !event.isComposing && event.keyCode !== 229 && !state.isComposing && now >= state.suppressEnterUntil;
}
