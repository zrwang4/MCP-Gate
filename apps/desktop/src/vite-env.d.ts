/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MCP_GATE_MANAGEMENT_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
