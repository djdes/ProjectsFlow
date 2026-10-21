/** Only two informational CLI banners; actual tool failures must remain visible. */
export function isWorkerStartupNotice(text: string): boolean {
  return /^Under-development features enabled: skip_host_skill_discovery\. Under-development features are incomplete and may behave unpredictably\. To suppress this warning, set `suppress_unstable_features_warning = true` in [^\r\n]+config\.toml\.$/.test(text.trim())
    || /^Exceeded skills context budget\. All skill descriptions were removed and \d+ additional skills were not included in the model-visible skills list\.$/.test(text.trim());
}
