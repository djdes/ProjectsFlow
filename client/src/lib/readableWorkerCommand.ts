export function readableWorkerCommand(command: string): string {
  let text = command;
  for (let depth = 0; depth < 4; depth++) {
    const encoded = /-(?:EncodedCommand|enc)\s+["']?([A-Za-z0-9+/=]+)/i.exec(text);
    if (!encoded || !/(?:powershell|pwsh)(?:\.exe)?/i.test(text)) break;
    if (encoded[1].length > 100_000) return 'Команда PowerShell: большой служебный блок';
    try {
      const bytes = Uint8Array.from(atob(encoded[1]), (char) => char.charCodeAt(0));
      if (bytes.length % 2) throw new Error('Invalid UTF-16');
      text = new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
      if (text.includes('\0')) throw new Error('Invalid command text');
    } catch { return 'Команда PowerShell: текст недоступен'; }
  }
  // Display the checked command, omitting only Ralph's known working-directory wrapper.
  const wrapped = /^\$ErrorActionPreference = 'Stop'; (?:\$ProgressPreference = 'SilentlyContinue'; \$workerUtf8 = New-Object Text\.UTF8Encoding\(\$false\); \[Console\]::InputEncoding = \$workerUtf8; \[Console\]::OutputEncoding = \$workerUtf8; \$OutputEncoding = \$workerUtf8; )?Set-Location -LiteralPath '[\s\S]*?'; \[IO\.Directory\]::SetCurrentDirectory\('[\s\S]*?'\); & \{\r?\n([\s\S]*)\r?\n\}; if \(\$null -ne \$LASTEXITCODE\) \{ exit \$LASTEXITCODE \}\s*$/.exec(text);
  const checked = (wrapped?.[1] ?? text).trim();
  // Old hook records contain UTF-8 bytes decoded as OEM 866. Repair only reversible
  // word fragments with repeated corruption markers; never change execution or history.
  if (!/[╨╤]/.test(checked)) return checked;
  try {
    const oem = new TextDecoder('ibm866');
    const bytes = new Map<string, number>();
    for (let byte = 128; byte <= 255; byte++) bytes.set(oem.decode(new Uint8Array([byte])), byte);
    return checked.replace(/[^\p{ASCII}]+/gu, (word) => {
      if ((word.match(/[╨╤]/g)?.length ?? 0) < 2) return word;
      const encoded: number[] = [];
      for (const char of word) {
        const byte = bytes.get(char);
        if (byte === undefined) return word;
        encoded.push(byte);
      }
      try {
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(encoded));
        return /[А-Яа-яЁё]/.test(decoded) && !/[╨╤]/.test(decoded) ? decoded : word;
      } catch { return word; }
    });
  } catch { return checked; }
}
