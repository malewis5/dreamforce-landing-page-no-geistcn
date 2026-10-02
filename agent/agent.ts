import { defineAgent } from "eve";

export default defineAgent({
  model: "openai/gpt-5.6-luna-fast",
  defaultTools: false,
  limits: {
    maxInputTokensPerSession: 40_000,
    maxOutputTokensPerSession: 4_000,
    maxTokenCostUsdPerSession: 0.25,
  },
});
