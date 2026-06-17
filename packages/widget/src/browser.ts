import { OpenSupportAI } from "./index.js";

declare global {
  interface Window {
    OpenSupportAI: typeof OpenSupportAI;
  }
}

window.OpenSupportAI = OpenSupportAI;
