import { openrouter } from "./openRouter";
import { kobold } from "./koboldCpp";
import { openai } from "./openAICompatible";
import { horde } from "./aiHorde";
import { nanogpt } from "./nanoGPT";
import { separate } from "./separate";
export const providers = {
  kobold: separate(kobold),
  openai: separate(openai),
  horde: separate(horde),
  openrouter: separate(openrouter),
  nanogpt: separate(nanogpt),
};
