(() => {
  const C = window.AIImpactCommon;
  if (!C || C.detectProvider() !== "claude" || window.__aiimClaude) return;
  window.__aiimClaude = true;

  // Claude non genera immagini o video in chat: niente scansione media, così le
  // immagini caricate dall'utente o le anteprime non vengono contate per errore.
  C.createTracker({
    provider: "claude",
    idleMs: 1500,
    composerSelectors: [
      "div.ProseMirror[contenteditable='true']",
      "[data-testid='chat-input']",
      "fieldset [contenteditable='true']",
      "textarea[data-testid='chat-input-ssr']"
    ],
    sendButtonSelectors: [
      "button[aria-label='Send message']",
      "button[aria-label='Send Message']",
      "button[aria-label*='Invia' i]",
      "fieldset button[type='submit']"
    ],
    stopSelectors: ["[data-is-streaming='true']", "button[aria-label='Stop response']", "button[aria-label*='Interrompi' i]"],
    regenerateSelectors: ["button[data-testid='action-bar-retry']", "button[aria-label='Retry']"],
    userSelectors: ["[data-testid='user-message']", "[data-user-message-bubble]", ".font-user-message"],
    assistantSelectors: [
      "div[data-is-streaming]",
      ".font-claude-response",
      ".font-claude-message",
      "[data-testid='assistant-message']"
    ],
    modelSelectors: ["[data-testid='model-selector-dropdown']", "button[data-testid*='model-selector']"]
  });
})();
