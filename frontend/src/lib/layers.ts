// Short names for the shield layers shown in the arena, keyed by backend check id.
export const LAYER_SHORT: Record<string, string> = {
  prompt_shields: 'Prompt Shields',
  text_moderation: 'Harm filter',
  azure_blocklist: 'Blocklist',
  obfuscation_heuristic: 'Obfuscation rule',
}

export const layerName = (checkId: string, fallback: string): string => LAYER_SHORT[checkId] ?? fallback
